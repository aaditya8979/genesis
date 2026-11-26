"""1,000-Concurrent-User Stress Benchmark (WebSockets + Burst Orders + Era Shock + Polling Fallback)."""

import asyncio
import json
import os
import statistics
import time
import uuid

import httpx
import websockets

BASE_HTTP = os.getenv("GENESIS_HTTP_URL", "http://127.0.0.1:8080")
BASE_WS = os.getenv("GENESIS_WS_URL", "ws://127.0.0.1:8080/ws/market")
ADMIN_SECRET = os.getenv("ADMIN_SECRET_KEY", "genesis_admin_master_2026")
TARGET_USERS = int(os.getenv("STRESS_USERS", "1000"))


async def spawn_ws_client(
    idx: int,
    connected_event: asyncio.Event,
    shock_latencies: list[float],
    errors: list[str],
    stop_event: asyncio.Event,
):
    url = f"{BASE_WS}?token=stress-{idx}"
    try:
        async with websockets.connect(url, open_timeout=15, ping_interval=None, max_size=2**22) as ws:
            await ws.recv()  # initial SNAPSHOT
            connected_event.set()
            while not stop_event.is_set():
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                    msg = json.loads(raw)
                    if msg.get("event") == "ERA_SHOCK":
                        shock_latencies.append(max(0.0, time.time() * 1000.0 - msg["server_time_ms"]))
                except asyncio.TimeoutError:
                    await ws.send('{"type":"ping"}')
    except Exception as exc:
        errors.append(f"ws-{idx}: {exc}")
        connected_event.set()


async def run_stress():
    print(f"Starting GENESIS 2026 {TARGET_USERS}-Concurrent-User Stress Benchmark against {BASE_HTTP}...")
    t0 = time.time()

    connected_events = [asyncio.Event() for _ in range(TARGET_USERS)]
    stop_event = asyncio.Event()
    shock_latencies: list[float] = []
    ws_errors: list[str] = []

    # 1. Ramp 1,000 WebSockets cleanly in batches of 100
    tasks = []
    for batch_start in range(0, TARGET_USERS, 100):
        for i in range(batch_start, min(batch_start + 100, TARGET_USERS)):
            tasks.append(asyncio.create_task(
                spawn_ws_client(i, connected_events[i], shock_latencies, ws_errors, stop_event)
            ))
        await asyncio.sleep(0.15)

    await asyncio.gather(*(ev.wait() for ev in connected_events))
    ramp_sec = round(time.time() - t0, 2)
    active_ws = TARGET_USERS - len(ws_errors)
    print(f"[WS RAMP] {active_ws}/{TARGET_USERS} sockets connected in {ramp_sec}s (errors: {len(ws_errors)})")

    # 2. Register 200 active traders and blast 400 concurrent BUY orders
    order_latencies_ms: list[float] = []
    order_500s: list[int] = []
    limits = httpx.Limits(max_connections=250, max_keepalive_connections=100)

    async with httpx.AsyncClient(base_url=BASE_HTTP, timeout=15.0, limits=limits) as client:
        async def login_and_trade(idx: int):
            res = await client.post("/api/v1/auth/login", json={
                "email": f"stress{idx}@vitbhopal.ac.in",
                "registration_no": f"25STR{idx:04d}",
            })
            if res.status_code != 200:
                order_500s.append(res.status_code)
                return
            token = res.json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}
            for sym in ("TMND", "RVB"):
                st = time.perf_counter()
                r = await client.post("/api/v1/trade/order", headers=headers, json={
                    "symbol": sym,
                    "action": "BUY",
                    "quantity": 10,
                    "client_order_id": str(uuid.uuid4()),
                })
                lat = (time.perf_counter() - st) * 1000.0
                order_latencies_ms.append(lat)
                if r.status_code >= 500:
                    order_500s.append(r.status_code)

        await asyncio.gather(*(login_and_trade(i) for i in range(200)))

        # Let any trailing coalesced broadcast flush, then trigger Era Shock
        await asyncio.sleep(0.5)
        shock_res = await client.post(
            "/api/v1/admin/scenario/trigger",
            headers={"X-Admin-Secret": ADMIN_SECRET},
            json={"era_id": "ERA_1_DOT_COM"},
        )
        assert shock_res.status_code == 200
        await asyncio.sleep(2.5)

        # 4. Verify HTTP Polling fallback & Snapshot export endpoint
        poll_res = await client.get("/api/v1/market/ticks?since_seq=0")
        assert poll_res.status_code == 200 and len(poll_res.json()["stocks"]) == 30

        snap_res = await client.get("/api/v1/system/snapshot", headers={"X-Admin-Secret": ADMIN_SECRET})
        assert snap_res.status_code == 200 and len(snap_res.json()["users"]) >= 200

        health = (await client.get("/health")).json()

    stop_event.set()
    await asyncio.gather(*tasks, return_exceptions=True)

    p50 = round(statistics.median(order_latencies_ms), 2) if order_latencies_ms else 0.0
    p99 = round(sorted(order_latencies_ms)[int(len(order_latencies_ms) * 0.99)], 2) if order_latencies_ms else 0.0
    fan_p50 = round(statistics.median(shock_latencies), 2) if shock_latencies else 0.0

    print(f"[ORDERS] {len(order_latencies_ms)} orders processed | p50={p50}ms | p99={p99}ms | HTTP 5xx={len(order_500s)}")
    print(f"[ERA FANOUT] {len(shock_latencies)}/{active_ws} clients received ERA_SHOCK (median delay ~{fan_p50}ms)")
    print(f"[HEALTH] {health}")

    assert len(order_500s) == 0, f"Detected HTTP 5xx errors: {order_500s}"
    assert active_ws >= int(TARGET_USERS * 0.98), f"Only {active_ws} WS connected"
    assert len(shock_latencies) >= int(active_ws * 0.95), f"Too few clients received ERA_SHOCK: {len(shock_latencies)}"


if __name__ == "__main__":
    asyncio.run(run_stress())
