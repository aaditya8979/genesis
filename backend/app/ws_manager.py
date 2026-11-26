"""High-concurrency WebSocket connection manager with slow-consumer isolation and targeted user push."""

import asyncio
import logging
from collections import defaultdict
from fastapi import WebSocket
import orjson

logger = logging.getLogger("genesis.ws")


def dumps_json(payload: dict) -> str:
    return orjson.dumps(payload).decode("utf-8")


class WebSocketManager:
    def __init__(self):
        # All market subscriber sockets -> optional user_id
        self.market_sockets: dict[WebSocket, str | None] = {}
        # Fast O(1) lookup of all sockets belonging to a specific user_id (multiple tabs supported)
        self.user_sockets: dict[str, set[WebSocket]] = defaultdict(set)
        # Admin telemetry console sockets
        self.admin_sockets: set[WebSocket] = set()
        self.total_broadcasts: int = 0
        self.evicted_slow_clients: int = 0

    @property
    def active_count(self) -> int:
        return len(self.market_sockets)

    async def connect_market(self, websocket: WebSocket, user_id: str | None = None) -> None:
        await websocket.accept()
        self.market_sockets[websocket] = user_id
        if user_id:
            self.user_sockets[user_id].add(websocket)

    def disconnect_market(self, websocket: WebSocket) -> None:
        user_id = self.market_sockets.pop(websocket, None)
        if user_id and user_id in self.user_sockets:
            self.user_sockets[user_id].discard(websocket)
            if not self.user_sockets[user_id]:
                self.user_sockets.pop(user_id, None)

    async def connect_admin(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.admin_sockets.add(websocket)

    def disconnect_admin(self, websocket: WebSocket) -> None:
        self.admin_sockets.discard(websocket)

    async def _safe_send(self, websocket: WebSocket, message: str, timeout: float = 0.25) -> WebSocket | None:
        """Send with strict timeout so 1 stalled 2G student phone cannot hang 999 other clients."""
        try:
            await asyncio.wait_for(websocket.send_text(message), timeout=timeout)
            return None
        except Exception:
            return websocket

    async def broadcast_market(self, payload: dict) -> None:
        if not self.market_sockets:
            return

        serialized = dumps_json(payload)
        sockets = list(self.market_sockets.keys())
        results = await asyncio.gather(
            *(self._safe_send(ws, serialized, timeout=0.25) for ws in sockets),
            return_exceptions=True,
        )
        self.total_broadcasts += 1

        for item in results:
            if isinstance(item, WebSocket):
                self.disconnect_market(item)
                self.evicted_slow_clients += 1

    async def send_to_user(self, user_id: str, payload: dict) -> int:
        """Instant real-time push to all active tabs of a specific student (e.g. CASH_TOPUP, ACCOUNT_FROZEN)."""
        sockets = list(self.user_sockets.get(user_id, set()))
        if not sockets:
            return 0

        serialized = dumps_json(payload)
        results = await asyncio.gather(
            *(self._safe_send(ws, serialized, timeout=0.5) for ws in sockets),
            return_exceptions=True,
        )
        delivered = 0
        for ws, res in zip(sockets, results):
            if res is None:
                delivered += 1
            elif isinstance(res, WebSocket):
                self.disconnect_market(res)
        return delivered

    async def broadcast_admin(self, payload: dict) -> None:
        if not self.admin_sockets:
            return
        serialized = dumps_json(payload)
        sockets = list(self.admin_sockets)
        results = await asyncio.gather(
            *(self._safe_send(ws, serialized, timeout=0.5) for ws in sockets),
            return_exceptions=True,
        )
        for item in results:
            if isinstance(item, WebSocket):
                self.disconnect_admin(item)


ws_manager = WebSocketManager()

