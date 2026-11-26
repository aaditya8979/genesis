"""GENESIS 2026 Multi-Tier Backup, Warm-Standby Sync & Supabase Cloud Vault Manager."""

import asyncio
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from decimal import Decimal
import json
import logging
import os
from pathlib import Path
import ssl
import time
from typing import Any

import asyncpg
import httpx
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import AsyncSessionLocal
from app.market_engine import market_engine
from app.models import AdminAuditLog, Holding, MarketSettings, Stock, Transaction, User, Wallet
from app.trading import d2
from app.ws_manager import dumps_json

settings = get_settings()
logger = logging.getLogger("genesis.backup")

_backup_trigger_event = asyncio.Event()
_force_checkpoint_flag = False
_last_checkpoint_ts = 0.0


@dataclass
class BackupRuntimeStatus:
    snapshot_interval_sec: float
    local_dir: str
    local_latest_seq: int
    local_latest_at: str | None
    local_history_count: int
    standby_push_url: str
    standby_last_status: str
    standby_last_at: str | None
    standby_last_error: str | None
    primary_pull_url: str
    pull_last_status: str
    pull_last_at: str | None
    supabase_mode: str
    supabase_last_status: str
    supabase_last_seq: int
    supabase_last_at: str | None
    supabase_last_error: str | None


backup_status = BackupRuntimeStatus(
    snapshot_interval_sec=settings.SNAPSHOT_INTERVAL_SECONDS,
    local_dir=settings.BACKUP_DIR,
    local_latest_seq=0,
    local_latest_at=None,
    local_history_count=0,
    standby_push_url=settings.STANDBY_SYNC_URL,
    standby_last_status="DISABLED" if not settings.STANDBY_SYNC_URL else "PENDING",
    standby_last_at=None,
    standby_last_error=None,
    primary_pull_url=settings.PRIMARY_SYNC_URL,
    pull_last_status="DISABLED" if not settings.PRIMARY_SYNC_URL else "PENDING",
    pull_last_at=None,
    supabase_mode=(
        "DUAL"
        if settings.SUPABASE_DB_URL and settings.SUPABASE_URL and settings.SUPABASE_SERVICE_KEY
        else "POSTGRES_URI"
        if settings.SUPABASE_DB_URL
        else "HTTPS_REST"
        if settings.SUPABASE_URL and settings.SUPABASE_SERVICE_KEY
        else "DISABLED"
    ),
    supabase_last_status=(
        "PENDING"
        if (settings.SUPABASE_DB_URL or (settings.SUPABASE_URL and settings.SUPABASE_SERVICE_KEY))
        else "DISABLED"
    ),
    supabase_last_seq=0,
    supabase_last_at=None,
    supabase_last_error=None,
)


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def request_background_backup(checkpoint: bool = False) -> None:
    """Signal the background snapshot exporter to flush immediately without blocking HTTP requests."""
    global _force_checkpoint_flag
    if checkpoint:
        _force_checkpoint_flag = True
    _backup_trigger_event.set()


def _parse_iso_dt(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        dt = datetime.fromisoformat(value)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


async def build_full_snapshot(db: AsyncSession) -> dict[str, Any]:
    """Export complete authoritative ledger (users, wallets, holdings, transactions) + RAM candles."""
    users_res = await db.execute(select(User))
    wallets_res = await db.execute(select(Wallet))
    holdings_res = await db.execute(select(Holding))
    tx_res = await db.execute(
        select(Transaction).order_by(desc(Transaction.created_at)).limit(10000)
    )
    tx_rows = list(reversed(tx_res.scalars().all()))

    return {
        "schema_version": 2,
        "exported_at": _utc_iso(),
        "seq": market_engine.seq,
        "market_runtime": market_engine.export_runtime_state(),
        "users": [
            {
                "id": u.id,
                "email": u.email,
                "registration_no": u.registration_no,
                "full_name": u.full_name,
                "role": u.role,
                "cohort": getattr(u, "cohort", "REAL") or "REAL",
                "status": u.status,
                "is_frozen": u.is_frozen,
            }
            for u in users_res.scalars().all()
        ],
        "wallets": [
            {
                "id": w.id,
                "user_id": w.user_id,
                "cash_balance": str(w.cash_balance),
                "collateral_locked": str(w.collateral_locked),
                "total_credited": str(w.total_credited),
                "topup_count": w.topup_count,
            }
            for w in wallets_res.scalars().all()
        ],
        "holdings": [
            {
                "id": h.id,
                "user_id": h.user_id,
                "stock_id": h.stock_id,
                "symbol": h.symbol,
                "position_type": h.position_type,
                "quantity": h.quantity,
                "avg_entry_price": str(h.avg_entry_price),
            }
            for h in holdings_res.scalars().all()
        ],
        "transactions": [
            {
                "id": t.id,
                "client_order_id": t.client_order_id,
                "user_id": t.user_id,
                "stock_id": t.stock_id,
                "symbol": t.symbol,
                "action": t.action,
                "quantity": t.quantity,
                "execution_price": str(t.execution_price),
                "total_amount": str(t.total_amount),
                "realized_pnl": str(t.realized_pnl),
                "created_at": t.created_at.isoformat() if t.created_at else _utc_iso(),
            }
            for t in tx_rows
        ],
    }


async def apply_snapshot_restore(db: AsyncSession, snap: dict[str, Any]) -> dict[str, Any]:
    """Idempotently hydrate RAM engine + Postgres ledger from any snapshot payload."""
    if "market_runtime" in snap:
        market_engine.restore_runtime_state(snap["market_runtime"])

    stocks_res = await db.execute(select(Stock))
    stock_by_sym = {s.symbol: s for s in stocks_res.scalars().all()}
    for sym, st in market_engine.stocks.items():
        if sym in stock_by_sym:
            stock_by_sym[sym].current_price = d2(st.current_price)
            stock_by_sym[sym].anchor_price = d2(st.anchor_price)

    # Remap snapshot user_id -> existing DB user.id by id or registration_no/email (prevents dummy UUID conflicts)
    existing_users_res = await db.execute(select(User))
    all_existing_users = existing_users_res.scalars().all()
    by_id = {u.id: u for u in all_existing_users}
    by_reg = {u.registration_no.upper(): u for u in all_existing_users}
    by_email = {u.email.lower(): u for u in all_existing_users}
    user_id_map: dict[str, str] = {}

    for udata in snap.get("users", []):
        old_id = udata["id"]
        reg_key = str(udata["registration_no"]).strip().upper()
        email_key = str(udata["email"]).strip().lower()
        target = by_id.get(old_id) or by_reg.get(reg_key) or by_email.get(email_key)
        if target is not None:
            target.is_frozen = bool(udata.get("is_frozen", False))
            target.status = udata.get("status", "APPROVED")
            if udata.get("full_name"):
                target.full_name = udata["full_name"]
            if "cohort" in udata:
                target.cohort = udata["cohort"]
            user_id_map[old_id] = target.id
        else:
            new_u = User(
                id=old_id,
                email=email_key,
                registration_no=reg_key,
                full_name=udata.get("full_name", ""),
                role=udata.get("role", "PARTICIPANT"),
                cohort=udata.get("cohort", "REAL"),
                status=udata.get("status", "APPROVED"),
                is_frozen=bool(udata.get("is_frozen", False)),
            )
            db.add(new_u)
            by_id[old_id] = new_u
            by_reg[reg_key] = new_u
            by_email[email_key] = new_u
            user_id_map[old_id] = old_id

    await db.flush()

    existing_wallets_res = await db.execute(select(Wallet))
    existing_wallets = {w.user_id: w for w in existing_wallets_res.scalars().all()}
    for wdata in snap.get("wallets", []):
        mapped_uid = user_id_map.get(wdata["user_id"], wdata["user_id"])
        if mapped_uid in existing_wallets:
            w = existing_wallets[mapped_uid]
            w.cash_balance = Decimal(wdata["cash_balance"])
            w.collateral_locked = Decimal(wdata["collateral_locked"])
            w.total_credited = Decimal(wdata["total_credited"])
            w.topup_count = int(wdata["topup_count"])
        else:
            w = Wallet(
                id=wdata["id"],
                user_id=mapped_uid,
                cash_balance=Decimal(wdata["cash_balance"]),
                collateral_locked=Decimal(wdata["collateral_locked"]),
                total_credited=Decimal(wdata["total_credited"]),
                topup_count=int(wdata["topup_count"]),
            )
            db.add(w)
            existing_wallets[mapped_uid] = w

    # Replace holdings atomically
    existing_holdings_res = await db.execute(select(Holding))
    for eh in existing_holdings_res.scalars().all():
        await db.delete(eh)
    await db.flush()

    for hdata in snap.get("holdings", []):
        sym = hdata["symbol"]
        mapped_stock_id = stock_by_sym[sym].id if sym in stock_by_sym else hdata["stock_id"]
        mapped_uid = user_id_map.get(hdata["user_id"], hdata["user_id"])
        db.add(Holding(
            id=hdata["id"],
            user_id=mapped_uid,
            stock_id=mapped_stock_id,
            symbol=sym,
            position_type=hdata["position_type"],
            quantity=int(hdata["quantity"]),
            avg_entry_price=Decimal(hdata["avg_entry_price"]),
        ))

    # Merge missing transactions idempotently by client_order_id
    restored_tx_count = 0
    if snap.get("transactions"):
        existing_coid_res = await db.execute(select(Transaction.client_order_id))
        existing_coids = {row[0] for row in existing_coid_res.fetchall()}
        existing_txid_res = await db.execute(select(Transaction.id))
        existing_txids = {row[0] for row in existing_txid_res.fetchall()}

        for tdata in snap["transactions"]:
            coid = tdata["client_order_id"]
            tid = tdata["id"]
            if coid in existing_coids or tid in existing_txids:
                continue
            sym = tdata["symbol"]
            mapped_stock_id = stock_by_sym[sym].id if sym in stock_by_sym else tdata["stock_id"]
            mapped_uid = user_id_map.get(tdata["user_id"], tdata["user_id"])
            db.add(Transaction(
                id=tid,
                client_order_id=coid,
                user_id=mapped_uid,
                stock_id=mapped_stock_id,
                symbol=sym,
                action=tdata["action"],
                quantity=int(tdata["quantity"]),
                execution_price=Decimal(tdata["execution_price"]),
                total_amount=Decimal(tdata["total_amount"]),
                realized_pnl=Decimal(tdata.get("realized_pnl", "0.00")),
                created_at=_parse_iso_dt(tdata.get("created_at")),
            ))
            existing_coids.add(coid)
            existing_txids.add(tid)
            restored_tx_count += 1

    ms_res = await db.execute(select(MarketSettings).where(MarketSettings.id == 1))
    ms = ms_res.scalar_one_or_none()
    if ms:
        ms.is_market_open = market_engine.is_market_open
        ms.is_leaderboard_frozen = market_engine.is_leaderboard_frozen
        ms.ticks_enabled = market_engine.ticks_enabled
        ms.active_era_id = market_engine.active_era_id
        ms.active_scenario_name = market_engine.active_scenario_name
        ms.active_headline = market_engine.active_headline

    db.add(AdminAuditLog(
        action_type="SNAPSHOT_RESTORE",
        details=f"Restored seq={market_engine.seq}, users={len(snap.get('users', []))}, tx={restored_tx_count}",
    ))
    await db.commit()
    return {
        "restored_users": len(snap.get("users", [])),
        "restored_holdings": len(snap.get("holdings", [])),
        "restored_transactions": restored_tx_count,
        "seq": market_engine.seq,
    }


def write_local_snapshot(snapshot: dict[str, Any], save_checkpoint: bool = False) -> Path:
    """Atomically write latest_snapshot.json and optional rolling checkpoint files."""
    backup_dir = Path(settings.BACKUP_DIR)
    backup_dir.mkdir(parents=True, exist_ok=True)
    raw_bytes = dumps_json(snapshot).encode("utf-8")

    target_path = backup_dir / "latest_snapshot.json"
    tmp_path = backup_dir / "latest_snapshot.json.tmp"
    tmp_path.write_bytes(raw_bytes)
    os.replace(tmp_path, target_path)

    history_dir = backup_dir / "history"
    history_dir.mkdir(parents=True, exist_ok=True)
    if save_checkpoint:
        seq = int(snapshot.get("seq", 0))
        stamp = datetime.now(timezone.utc).strftime("%H%M%S")
        ckpt_path = history_dir / f"snap_{seq:07d}_{stamp}.json"
        ckpt_tmp = history_dir / f"snap_{seq:07d}_{stamp}.json.tmp"
        ckpt_tmp.write_bytes(raw_bytes)
        os.replace(ckpt_tmp, ckpt_path)

        # Keep latest 30 checkpoints bounded on disk
        checkpoints = sorted(history_dir.glob("snap_*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in checkpoints[30:]:
            old.unlink(missing_ok=True)

    backup_status.local_dir = str(backup_dir)
    backup_status.local_latest_seq = int(snapshot.get("seq", 0))
    backup_status.local_latest_at = snapshot.get("exported_at")
    backup_status.local_history_count = len(list(history_dir.glob("snap_*.json")))
    return target_path


def load_local_snapshot() -> dict[str, Any] | None:
    target = Path(settings.BACKUP_DIR) / "latest_snapshot.json"
    if not target.exists():
        return None
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Failed to parse local latest_snapshot.json: %s", exc)
        return None


def _normalize_supabase_dsn(url: str) -> str:
    clean = url.strip()
    if clean.startswith("postgresql+asyncpg://"):
        clean = "postgresql://" + clean[len("postgresql+asyncpg://"):]
    elif clean.startswith("postgres://"):
        clean = "postgresql://" + clean[len("postgres://"):]
    return clean


async def _ensure_supabase_pg_schema(conn: asyncpg.Connection) -> None:
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS genesis_snapshots (
            id TEXT PRIMARY KEY,
            seq BIGINT NOT NULL DEFAULT 0,
            era_id TEXT NOT NULL DEFAULT 'BASE',
            user_count INTEGER NOT NULL DEFAULT 0,
            exported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            payload JSONB NOT NULL
        );
        """
    )


async def push_snapshot_to_supabase(snapshot: dict[str, Any], save_rolling_slot: bool = False) -> bool:
    """Mirror latest full snapshot asynchronously to Supabase Cloud Vault (Postgres URI and/or HTTPS REST)."""
    has_pg = bool(settings.SUPABASE_DB_URL.strip())
    has_rest = bool(settings.SUPABASE_URL.strip() and settings.SUPABASE_SERVICE_KEY.strip())
    if not (has_pg or has_rest):
        return False

    seq = int(snapshot.get("seq", 0))
    era_id = str(snapshot.get("market_runtime", {}).get("active_era_id", "BASE"))
    user_count = len(snapshot.get("users", []))
    exported_at = snapshot.get("exported_at") or _utc_iso()
    payload_str = dumps_json(snapshot)
    errors: list[str] = []
    pushed = False

    if has_pg:
        try:
            dsn = _normalize_supabase_dsn(settings.SUPABASE_DB_URL)
            ssl_ctx = ssl.create_default_context()
            conn = await asyncpg.connect(
                dsn=dsn,
                timeout=6.0,
                statement_cache_size=0,  # Required for Supabase PgBouncer Transaction Pooler (port 6543)
                ssl=ssl_ctx,
            )
            try:
                await _ensure_supabase_pg_schema(conn)
                await conn.execute(
                    """
                    INSERT INTO genesis_snapshots (id, seq, era_id, user_count, exported_at, payload)
                    VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb)
                    ON CONFLICT (id) DO UPDATE SET
                        seq = EXCLUDED.seq,
                        era_id = EXCLUDED.era_id,
                        user_count = EXCLUDED.user_count,
                        exported_at = EXCLUDED.exported_at,
                        payload = EXCLUDED.payload
                    """,
                    "latest",
                    seq,
                    era_id,
                    user_count,
                    exported_at,
                    payload_str,
                )
                if save_rolling_slot:
                    slot_id = f"ckpt_{seq % 10}"
                    await conn.execute(
                        """
                        INSERT INTO genesis_snapshots (id, seq, era_id, user_count, exported_at, payload)
                        VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb)
                        ON CONFLICT (id) DO UPDATE SET
                            seq = EXCLUDED.seq,
                            era_id = EXCLUDED.era_id,
                            user_count = EXCLUDED.user_count,
                            exported_at = EXCLUDED.exported_at,
                            payload = EXCLUDED.payload
                        """,
                        slot_id,
                        seq,
                        era_id,
                        user_count,
                        exported_at,
                        payload_str,
                    )
                pushed = True
            finally:
                await conn.close()
        except Exception as exc:
            errors.append(f"PG: {exc}")

    if has_rest and (not pushed or backup_status.supabase_mode == "DUAL"):
        try:
            base = settings.SUPABASE_URL.strip().rstrip("/")
            table = settings.SUPABASE_SNAPSHOT_TABLE.strip() or "genesis_snapshots"
            key = settings.SUPABASE_SERVICE_KEY.strip()
            headers = {
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            }
            rows = [
                {
                    "id": "latest",
                    "seq": seq,
                    "era_id": era_id,
                    "user_count": user_count,
                    "exported_at": exported_at,
                    "payload": snapshot,
                }
            ]
            if save_rolling_slot:
                rows.append({
                    "id": f"ckpt_{seq % 10}",
                    "seq": seq,
                    "era_id": era_id,
                    "user_count": user_count,
                    "exported_at": exported_at,
                    "payload": snapshot,
                })
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.post(
                    f"{base}/rest/v1/{table}?on_conflict=id",
                    json=rows,
                    headers=headers,
                )
                if resp.status_code not in (200, 201, 204):
                    raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:180]}")
                pushed = True
        except Exception as exc:
            errors.append(f"REST: {exc}")

    if pushed:
        backup_status.supabase_last_status = "SYNCED"
        backup_status.supabase_last_seq = seq
        backup_status.supabase_last_at = _utc_iso()
        backup_status.supabase_last_error = "; ".join(errors) if errors else None
    else:
        backup_status.supabase_last_status = "ERROR"
        backup_status.supabase_last_error = "; ".join(errors) or "Unknown error"
    return pushed


async def pull_latest_from_supabase() -> dict[str, Any] | None:
    """Fetch the newest authoritative snapshot from Supabase Cloud Vault."""
    if settings.SUPABASE_DB_URL.strip():
        try:
            dsn = _normalize_supabase_dsn(settings.SUPABASE_DB_URL)
            conn = await asyncpg.connect(
                dsn=dsn,
                timeout=6.0,
                statement_cache_size=0,
                ssl=ssl.create_default_context(),
            )
            try:
                row = await conn.fetchrow(
                    "SELECT payload FROM genesis_snapshots ORDER BY seq DESC LIMIT 1"
                )
                if row and row["payload"]:
                    raw = row["payload"]
                    return json.loads(raw) if isinstance(raw, str) else dict(raw)
            finally:
                await conn.close()
        except Exception as exc:
            logger.warning("Supabase PG pull failed: %s", exc)

    if settings.SUPABASE_URL.strip() and settings.SUPABASE_SERVICE_KEY.strip():
        try:
            base = settings.SUPABASE_URL.strip().rstrip("/")
            table = settings.SUPABASE_SNAPSHOT_TABLE.strip() or "genesis_snapshots"
            key = settings.SUPABASE_SERVICE_KEY.strip()
            headers = {
                "apikey": key,
                "Authorization": f"Bearer {key}",
            }
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(
                    f"{base}/rest/v1/{table}?select=payload&order=seq.desc&limit=1",
                    headers=headers,
                )
                if resp.status_code == 200:
                    rows = resp.json()
                    if rows and isinstance(rows[0].get("payload"), dict):
                        return rows[0]["payload"]
        except Exception as exc:
            logger.warning("Supabase REST pull failed: %s", exc)

    return None


async def push_snapshot_to_standby(snapshot: dict[str, Any]) -> bool:
    if not settings.STANDBY_SYNC_URL.strip():
        return False
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                f"{settings.STANDBY_SYNC_URL.strip().rstrip('/')}/api/v1/system/restore",
                content=dumps_json(snapshot).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "X-Sync-Secret": settings.STANDBY_SYNC_SECRET,
                },
            )
            if resp.status_code >= 400:
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:160]}")
        backup_status.standby_last_status = "SYNCED"
        backup_status.standby_last_at = _utc_iso()
        backup_status.standby_last_error = None
        return True
    except Exception as exc:
        backup_status.standby_last_status = "UNREACHABLE"
        backup_status.standby_last_error = str(exc)
        return False


async def pull_snapshot_from_primary() -> dict[str, Any] | None:
    if not settings.PRIMARY_SYNC_URL.strip():
        return None
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{settings.PRIMARY_SYNC_URL.strip().rstrip('/')}/api/v1/system/snapshot",
                headers={"X-Sync-Secret": settings.STANDBY_SYNC_SECRET},
            )
            if resp.status_code != 200:
                raise RuntimeError(f"HTTP {resp.status_code}")
            snap = resp.json()
        backup_status.pull_last_status = "SYNCED"
        backup_status.pull_last_at = _utc_iso()
        return snap
    except Exception as exc:
        backup_status.pull_last_status = f"PRIMARY_DOWN ({exc})"
        return None


async def execute_full_backup_cycle(save_checkpoint: bool = False) -> dict[str, Any]:
    """Capture authoritative snapshot and dispatch cleanly across Local + Standby + Supabase."""
    global _last_checkpoint_ts
    now = time.time()
    do_ckpt = save_checkpoint or (now - _last_checkpoint_ts >= 60.0)
    if do_ckpt:
        _last_checkpoint_ts = now

    async with AsyncSessionLocal() as db:
        stocks_res = await db.execute(select(Stock))
        for srow in stocks_res.scalars().all():
            if srow.symbol in market_engine.stocks:
                srow.current_price = d2(market_engine.stocks[srow.symbol].current_price)
                srow.anchor_price = d2(market_engine.stocks[srow.symbol].anchor_price)
        await db.commit()
        snapshot = await build_full_snapshot(db)

    write_local_snapshot(snapshot, save_checkpoint=do_ckpt)

    # Fire Tier-2 (Warm Standby) and Tier-3 (Supabase Vault) concurrently without blocking trades
    results = await asyncio.gather(
        push_snapshot_to_standby(snapshot),
        push_snapshot_to_supabase(snapshot, save_rolling_slot=do_ckpt),
        return_exceptions=True,
    )
    return {
        "seq": snapshot["seq"],
        "exported_at": snapshot["exported_at"],
        "users": len(snapshot["users"]),
        "holdings": len(snapshot["holdings"]),
        "transactions": len(snapshot["transactions"]),
        "standby_synced": results[0] is True,
        "supabase_synced": results[1] is True,
    }


async def startup_auto_recover() -> dict[str, Any] | None:
    """Self-heal database & RAM market state automatically on boot/failover."""
    if not settings.AUTO_RESTORE_ON_BOOT or settings.ENVIRONMENT == "test":
        return None

    async with AsyncSessionLocal() as db:
        real_users_res = await db.execute(
            select(User.id).where(User.role == "PARTICIPANT", User.cohort == "REAL")
        )
        real_count = len(real_users_res.fetchall())

    candidates: list[tuple[str, dict[str, Any]]] = []
    local_snap = load_local_snapshot()
    if local_snap:
        candidates.append(("LOCAL_DISK", local_snap))

    remote_results = await asyncio.gather(
        pull_snapshot_from_primary(),
        pull_latest_from_supabase(),
        return_exceptions=True,
    )
    if isinstance(remote_results[0], dict):
        candidates.append(("PRIMARY_SYNC", remote_results[0]))
    if isinstance(remote_results[1], dict):
        candidates.append(("SUPABASE_VAULT", remote_results[1]))

    if not candidates:
        return None

    # Pick snapshot with highest sequence number (and non-trivial state)
    best_source, best_snap = max(
        candidates,
        key=lambda item: (int(item[1].get("seq", 0)), len(item[1].get("users", []))),
    )
    best_seq = int(best_snap.get("seq", 0))
    best_real = sum(1 for u in best_snap.get("users", []) if u.get("cohort", "REAL") == "REAL")

    # Case 1: Fresh/wiped DB with zero real participants -> full DB + RAM disaster recovery
    if real_count == 0 and (best_real > 0 or best_seq > 5):
        async with AsyncSessionLocal() as db:
            res = await apply_snapshot_restore(db, best_snap)
        logger.info("AUTO-RECOVERED wiped/fresh DB from %s (seq=%s, users=%s)", best_source, best_seq, res["restored_users"])
        return {"source": best_source, "mode": "FULL_RECOVERY", **res}

    # Case 2: Postgres survived a backend process restart -> preserve Postgres ledger, hydrate RAM candles/seq/events
    if best_seq > market_engine.seq and "market_runtime" in best_snap:
        market_engine.restore_runtime_state(best_snap["market_runtime"])
        logger.info("HYDRATED RAM candles & market_runtime on boot from %s (seq=%s)", best_source, best_seq)
        return {"source": best_source, "mode": "RUNTIME_CANDLES_ONLY", "seq": best_seq}

    return None


async def snapshot_exporter_loop() -> None:
    """Periodic + event-driven backup exporter (or pull loop when running as Tier-2 Standby)."""
    global _force_checkpoint_flag
    Path(settings.BACKUP_DIR).mkdir(parents=True, exist_ok=True)
    while True:
        try:
            try:
                await asyncio.wait_for(
                    _backup_trigger_event.wait(),
                    timeout=max(2.0, settings.SNAPSHOT_INTERVAL_SECONDS),
                )
            except asyncio.TimeoutError:
                pass
            _backup_trigger_event.clear()
            ckpt = _force_checkpoint_flag
            _force_checkpoint_flag = False

            if settings.PRIMARY_SYNC_URL.strip():
                snap = await pull_snapshot_from_primary()
                if snap and int(snap.get("seq", 0)) > market_engine.seq:
                    async with AsyncSessionLocal() as db:
                        await apply_snapshot_restore(db, snap)
                    write_local_snapshot(snap, save_checkpoint=False)
                continue

            await execute_full_backup_cycle(save_checkpoint=ckpt)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("Snapshot exporter warning (non-fatal): %s", exc)


def get_backup_status() -> dict[str, Any]:
    return asdict(backup_status)
