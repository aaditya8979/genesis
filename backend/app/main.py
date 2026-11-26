"""GENESIS 2026 Virtual Stock Exchange — FastAPI + Single-Worker uvloop Application."""

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from decimal import Decimal
import json
import logging
import os
from pathlib import Path
import time

from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
import httpx
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import create_access_token, decode_token, get_current_user, verify_admin
from app.config import get_settings
from app.db import AsyncSessionLocal, Base, engine, get_db
from app.market_engine import market_engine
from app.models import AdminAuditLog, Holding, MarketSettings, Stock, Transaction, User, Wallet
from app.scenarios_config import SCENARIOS_MAP, STOCKS_CATALOG
from app.trading import compute_user_portfolio, d2, execute_trade, run_short_squeeze_supervisor
from app.ws_manager import dumps_json, ws_manager

settings = get_settings()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("genesis.api")

START_TIME = time.time()


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------
class StudentLoginRequest(BaseModel):
    email: EmailStr
    registration_no: str = Field(..., min_length=3, max_length=50)
    full_name: str | None = Field(default=None, max_length=150)


class AdminLoginRequest(BaseModel):
    secret_key: str


class TradeOrderRequest(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=10)
    action: str = Field(..., pattern="^(BUY|SELL|SHORT|COVER|buy|sell|short|cover)$")
    quantity: int = Field(..., gt=0, le=40)
    client_order_id: str = Field(..., min_length=4, max_length=64)


class TopupRequest(BaseModel):
    registration_no: str = Field(..., min_length=2, max_length=50)
    amount: float = Field(..., gt=0, le=500000)
    note: str = Field(default="Admin manual wallet top-up", max_length=200)


class FreezeUserRequest(BaseModel):
    registration_no: str
    is_frozen: bool


class TriggerEraRequest(BaseModel):
    era_id: str


class WhaleOrderRequest(BaseModel):
    symbol: str
    side: str = Field(..., pattern="^(BUY|SELL)$")
    quantity: int = Field(..., gt=0, le=100000)


class PriceOverrideRequest(BaseModel):
    symbol: str
    target_price: float = Field(..., ge=10.0)


class MarketPauseRequest(BaseModel):
    is_market_open: bool


class ToggleTicksRequest(BaseModel):
    ticks_enabled: bool


class BroadcastHeadlineRequest(BaseModel):
    headline: str = Field(..., min_length=2, max_length=300)


# ---------------------------------------------------------------------------
# Database Seeding & Snapshot Persistence Helpers
# ---------------------------------------------------------------------------
async def seed_initial_data() -> None:
    async with AsyncSessionLocal() as db:
        existing_stocks_res = await db.execute(select(Stock))
        existing_stocks = {s.symbol: s for s in existing_stocks_res.scalars().all()}

        if not existing_stocks:
            for item in STOCKS_CATALOG:
                db.add(Stock(
                    symbol=item["symbol"],
                    company_name=item["company_name"],
                    sector=item["sector"],
                    current_price=d2(item["base_price"]),
                    anchor_price=d2(item["base_price"]),
                    pe_ratio=d2(item["pe_ratio"]),
                    max_shares_per_user=settings.MAX_SHARES_PER_STOCK,
                ))
        else:
            # Hydrate RAM prices from DB if restarting after crash
            for sym, st_row in existing_stocks.items():
                if sym in market_engine.stocks:
                    market_engine.stocks[sym].current_price = float(st_row.current_price)
                    market_engine.stocks[sym].anchor_price = float(st_row.anchor_price)

        ms_res = await db.execute(select(MarketSettings).where(MarketSettings.id == 1))
        ms = ms_res.scalar_one_or_none()
        if ms is None:
            db.add(MarketSettings(id=1))
        else:
            market_engine.is_market_open = ms.is_market_open
            market_engine.is_leaderboard_frozen = ms.is_leaderboard_frozen
            market_engine.ticks_enabled = ms.ticks_enabled
            market_engine.active_era_id = ms.active_era_id
            market_engine.active_scenario_name = ms.active_scenario_name
            market_engine.active_headline = ms.active_headline

        await db.commit()


async def build_full_snapshot(db: AsyncSession) -> dict:
    users_res = await db.execute(select(User))
    wallets_res = await db.execute(select(Wallet))
    holdings_res = await db.execute(select(Holding))

    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "market_runtime": market_engine.export_runtime_state(),
        "users": [
            {
                "id": u.id,
                "email": u.email,
                "registration_no": u.registration_no,
                "full_name": u.full_name,
                "role": u.role,
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
    }


async def apply_snapshot_restore(db: AsyncSession, snap: dict) -> dict:
    if "market_runtime" in snap:
        market_engine.restore_runtime_state(snap["market_runtime"])

    # Sync stocks table with restored prices
    stocks_res = await db.execute(select(Stock))
    stock_by_sym = {s.symbol: s for s in stocks_res.scalars().all()}
    for sym, st in market_engine.stocks.items():
        if sym in stock_by_sym:
            stock_by_sym[sym].current_price = d2(st.current_price)
            stock_by_sym[sym].anchor_price = d2(st.anchor_price)

    # Upsert users
    existing_users_res = await db.execute(select(User))
    existing_users = {u.id: u for u in existing_users_res.scalars().all()}
    for udata in snap.get("users", []):
        if udata["id"] in existing_users:
            u = existing_users[udata["id"]]
            u.is_frozen = udata["is_frozen"]
            u.status = udata["status"]
        else:
            db.add(User(
                id=udata["id"],
                email=udata["email"],
                registration_no=udata["registration_no"],
                full_name=udata.get("full_name", ""),
                role=udata.get("role", "PARTICIPANT"),
                status=udata.get("status", "APPROVED"),
                is_frozen=udata.get("is_frozen", False),
            ))

    await db.flush()

    # Upsert wallets
    existing_wallets_res = await db.execute(select(Wallet))
    existing_wallets = {w.user_id: w for w in existing_wallets_res.scalars().all()}
    for wdata in snap.get("wallets", []):
        if wdata["user_id"] in existing_wallets:
            w = existing_wallets[wdata["user_id"]]
            w.cash_balance = Decimal(wdata["cash_balance"])
            w.collateral_locked = Decimal(wdata["collateral_locked"])
            w.total_credited = Decimal(wdata["total_credited"])
            w.topup_count = wdata["topup_count"]
        else:
            db.add(Wallet(
                id=wdata["id"],
                user_id=wdata["user_id"],
                cash_balance=Decimal(wdata["cash_balance"]),
                collateral_locked=Decimal(wdata["collateral_locked"]),
                total_credited=Decimal(wdata["total_credited"]),
                topup_count=wdata["topup_count"],
            ))

    # Replace holdings atomically
    existing_holdings_res = await db.execute(select(Holding))
    for eh in existing_holdings_res.scalars().all():
        await db.delete(eh)
    await db.flush()

    for hdata in snap.get("holdings", []):
        sym = hdata["symbol"]
        mapped_stock_id = stock_by_sym[sym].id if sym in stock_by_sym else hdata["stock_id"]
        db.add(Holding(
            id=hdata["id"],
            user_id=hdata["user_id"],
            stock_id=mapped_stock_id,
            symbol=sym,
            position_type=hdata["position_type"],
            quantity=int(hdata["quantity"]),
            avg_entry_price=Decimal(hdata["avg_entry_price"]),
        ))

    ms_res = await db.execute(select(MarketSettings).where(MarketSettings.id == 1))
    ms = ms_res.scalar_one_or_none()
    if ms:
        ms.is_market_open = market_engine.is_market_open
        ms.ticks_enabled = market_engine.ticks_enabled
        ms.active_era_id = market_engine.active_era_id
        ms.active_scenario_name = market_engine.active_scenario_name
        ms.active_headline = market_engine.active_headline

    await db.commit()
    return {
        "restored_users": len(snap.get("users", [])),
        "restored_holdings": len(snap.get("holdings", [])),
        "seq": market_engine.seq,
    }


async def compute_admin_overview(db: AsyncSession) -> dict:
    users_res = await db.execute(select(User).where(User.role == "PARTICIPANT"))
    users = users_res.scalars().all()
    wallets_res = await db.execute(select(Wallet))
    wallets = {w.user_id: w for w in wallets_res.scalars().all()}
    holdings_res = await db.execute(select(Holding))
    holdings_by_user: dict[str, list[Holding]] = {}
    stock_exposure: dict[str, dict] = {}

    for h in holdings_res.scalars().all():
        holdings_by_user.setdefault(h.user_id, []).append(h)
        exp = stock_exposure.setdefault(h.symbol, {"symbol": h.symbol, "long_shares": 0, "short_shares": 0})
        if h.position_type == "LONG":
            exp["long_shares"] += h.quantity
        else:
            exp["short_shares"] += h.quantity

    total_cash_circulation = Decimal("0.00")
    participants = []

    for u in users:
        w = wallets.get(u.id)
        if not w:
            continue
        cash = d2(w.cash_balance)
        collat = d2(w.collateral_locked)
        total_cash_circulation += cash + collat

        long_val = Decimal("0.00")
        short_liab = Decimal("0.00")
        u_holdings = holdings_by_user.get(u.id, [])
        for h in u_holdings:
            p = d2(market_engine.stocks[h.symbol].current_price) if h.symbol in market_engine.stocks else d2(h.avg_entry_price)
            if h.position_type == "LONG":
                long_val += d2(Decimal(h.quantity) * p)
            else:
                short_liab += d2(Decimal(h.quantity) * p)

        net_worth = d2(cash + long_val + collat - short_liab)
        participants.append({
            "user_id": u.id,
            "email": u.email,
            "registration_no": u.registration_no,
            "full_name": u.full_name,
            "is_frozen": u.is_frozen,
            "cash_balance": float(cash),
            "collateral_locked": float(collat),
            "total_credited": float(w.total_credited),
            "topup_count": w.topup_count,
            "net_worth": float(net_worth),
            "positions_count": len(u_holdings),
        })

    participants.sort(key=lambda x: x["net_worth"], reverse=True)
    top_stocks_exposure = sorted(
        stock_exposure.values(),
        key=lambda x: x["long_shares"] + x["short_shares"],
        reverse=True,
    )[:8]

    logs_res = await db.execute(select(AdminAuditLog).order_by(desc(AdminAuditLog.created_at)).limit(20))
    logs = [
        {
            "id": log.id,
            "action_type": log.action_type,
            "details": log.details,
            "created_at": log.created_at.isoformat(),
        }
        for log in logs_res.scalars().all()
    ]

    return {
        "active_sockets": ws_manager.active_count,
        "total_broadcasts": ws_manager.total_broadcasts,
        "evicted_slow_clients": ws_manager.evicted_slow_clients,
        "orders_per_sec": market_engine.last_orders_per_sec,
        "registered_count": len(participants),
        "total_cash_circulation": float(total_cash_circulation),
        "is_market_open": market_engine.is_market_open,
        "ticks_enabled": market_engine.ticks_enabled,
        "active_era_id": market_engine.active_era_id,
        "active_scenario_name": market_engine.active_scenario_name,
        "active_headline": market_engine.active_headline,
        "participants": participants,
        "top_exposure": top_stocks_exposure,
        "recent_logs": logs,
        "eras": [
            {"id": e["id"], "order": e["order"], "name": e["name"], "severity": e["severity"]}
            for e in sorted(SCENARIOS_MAP.values(), key=lambda x: x["order"])
        ],
    }


# ---------------------------------------------------------------------------
# Background Tasks: Tick Loop & Warm-Standby Snapshot Exporter
# ---------------------------------------------------------------------------
async def market_tick_loop() -> None:
    tick_count = 0
    while True:
        try:
            await asyncio.sleep(settings.TICK_INTERVAL_SECONDS)
            tick_count += 1
            if tick_count % 2 == 0:
                market_engine.step_jitter_if_enabled()
            else:
                # Advance candle bucket timestamp even between jitter steps
                now_sec = int(time.time())
                for st in market_engine.stocks.values():
                    st._upsert_candle((now_sec // 5) * 5, st.current_price, 0)

            payload = market_engine.build_tick_payload("PRICE_TICK")
            await ws_manager.broadcast_market(payload)

            if tick_count % 3 == 0:
                async with AsyncSessionLocal() as db:
                    await run_short_squeeze_supervisor(db)
                    if ws_manager.admin_sockets:
                        overview = await compute_admin_overview(db)
                        await ws_manager.broadcast_admin({"event": "ADMIN_TELEMETRY", "data": overview})
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.exception("Error in market_tick_loop: %s", exc)


async def snapshot_exporter_loop() -> None:
    Path(settings.BACKUP_DIR).mkdir(parents=True, exist_ok=True)
    while True:
        try:
            await asyncio.sleep(settings.SNAPSHOT_INTERVAL_SECONDS)
            async with AsyncSessionLocal() as db:
                # Sync stock prices periodically to Postgres
                stocks_res = await db.execute(select(Stock))
                for srow in stocks_res.scalars().all():
                    if srow.symbol in market_engine.stocks:
                        srow.current_price = d2(market_engine.stocks[srow.symbol].current_price)
                await db.commit()

                snapshot = await build_full_snapshot(db)

            # Atomic file write (.tmp -> replace) so backups are never corrupted mid-write
            target_path = Path(settings.BACKUP_DIR) / "latest_snapshot.json"
            tmp_path = Path(settings.BACKUP_DIR) / "latest_snapshot.json.tmp"
            tmp_path.write_bytes(dumps_json(snapshot).encode("utf-8"))
            os.replace(tmp_path, target_path)

            if settings.STANDBY_SYNC_URL:
                async with httpx.AsyncClient(timeout=3.0) as client:
                    await client.post(
                        f"{settings.STANDBY_SYNC_URL.rstrip('/')}/api/v1/system/restore",
                        json=snapshot,
                        headers={"X-Sync-Secret": settings.STANDBY_SYNC_SECRET},
                    )
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("Snapshot exporter warning (non-fatal): %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await seed_initial_data()

    tick_task = asyncio.create_task(market_tick_loop())
    snap_task = asyncio.create_task(snapshot_exporter_loop())
    logger.info("GENESIS 2026 Exchange Engine online (30 equities, 10 eras, single-worker RAM mode)")
    try:
        yield
    finally:
        tick_task.cancel()
        snap_task.cancel()
        await asyncio.gather(tick_task, snap_task, return_exceptions=True)


app = FastAPI(
    title="GENESIS 2026 Virtual Stock Exchange",
    version="2.0.0",
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
)

origins = [o.strip() for o in settings.CORS_ORIGINS.split(",")] if settings.CORS_ORIGINS != "*" else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health Check
# ---------------------------------------------------------------------------
@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "uptime_sec": round(time.time() - START_TIME, 1),
        "active_sockets": ws_manager.active_count,
        "seq": market_engine.seq,
        "is_market_open": market_engine.is_market_open,
    }


# ---------------------------------------------------------------------------
# Simplified Student & Admin Authentication (Email + Registration No only)
# ---------------------------------------------------------------------------
@app.post("/api/v1/auth/login")
async def student_login(body: StudentLoginRequest, db: AsyncSession = Depends(get_db)):
    email = body.email.strip().lower()
    reg_no = body.registration_no.strip().upper()
    name_val = (body.full_name or reg_no).strip()

    res_reg = await db.execute(select(User).where(User.registration_no == reg_no))
    user = res_reg.scalar_one_or_none()

    if user is not None:
        if user.email.lower() != email:
            raise HTTPException(
                status_code=409,
                detail="This Registration Number is already registered to a different email address.",
            )
    else:
        res_email = await db.execute(select(User).where(User.email == email))
        existing_email_user = res_email.scalar_one_or_none()
        if existing_email_user is not None:
            raise HTTPException(
                status_code=409,
                detail="This Email is already linked to a different Registration Number.",
            )

        user = User(
            email=email,
            registration_no=reg_no,
            full_name=name_val,
            role="PARTICIPANT",
            status="APPROVED",
            is_frozen=False,
        )
        db.add(user)
        await db.flush()
        db.add(Wallet(
            user_id=user.id,
            cash_balance=d2(settings.STARTING_CASH),
            collateral_locked=Decimal("0.00"),
            total_credited=d2(settings.STARTING_CASH),
            topup_count=0,
        ))
        await db.commit()
        await db.refresh(user)

    token = create_access_token(user.id, user.email, user.registration_no, user.role)
    portfolio = await compute_user_portfolio(db, user.id)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "registration_no": user.registration_no,
            "full_name": user.full_name,
            "role": user.role,
            "is_frozen": user.is_frozen,
        },
        "portfolio": portfolio,
    }


@app.post("/api/v1/auth/admin-login")
async def admin_login(body: AdminLoginRequest):
    if body.secret_key != settings.ADMIN_SECRET_KEY:
        raise HTTPException(status_code=403, detail="Invalid Admin Secret Key")
    token = create_access_token("admin-root", "admin@genesis2026.in", "ADMIN", "ADMIN")
    return {"access_token": token, "token_type": "bearer", "role": "ADMIN"}


# ---------------------------------------------------------------------------
# Authoritative State Bootstrap & HTTP Polling Fallback
# ---------------------------------------------------------------------------
@app.get("/api/v1/bootstrap")
async def bootstrap_terminal(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    portfolio = await compute_user_portfolio(db, user.id)
    tx_res = await db.execute(
        select(Transaction)
        .where(Transaction.user_id == user.id)
        .order_by(desc(Transaction.created_at))
        .limit(40)
    )
    tx_list = [
        {
            "id": t.id,
            "symbol": t.symbol,
            "action": t.action,
            "quantity": t.quantity,
            "execution_price": float(t.execution_price),
            "total_amount": float(t.total_amount),
            "realized_pnl": float(t.realized_pnl),
            "created_at": t.created_at.isoformat(),
        }
        for t in tx_res.scalars().all()
    ]

    return {
        "server_time_ms": int(time.time() * 1000),
        "seq": market_engine.seq,
        "is_market_open": market_engine.is_market_open,
        "ticks_enabled": market_engine.ticks_enabled,
        "active_era_id": market_engine.active_era_id,
        "active_scenario_name": market_engine.active_scenario_name,
        "active_headline": market_engine.active_headline,
        "user": {
            "id": user.id,
            "email": user.email,
            "registration_no": user.registration_no,
            "full_name": user.full_name,
            "is_frozen": user.is_frozen,
        },
        "portfolio": portfolio,
        "transactions": tx_list,
        "stocks": market_engine.get_bootstrap_catalog(),
    }


@app.get("/api/v1/market/ticks")
async def poll_market_ticks(since_seq: int = Query(default=0)):
    """HTTP Port 443 fallback when campus firewall blocks WSS upgrades."""
    if market_engine.tick_history and since_seq < market_engine.seq:
        latest = market_engine.tick_history[-1]
        return latest
    return market_engine.build_tick_payload("PRICE_TICK")


# ---------------------------------------------------------------------------
# Trading & Portfolio Endpoints
# ---------------------------------------------------------------------------
@app.post("/api/v1/trade/order")
async def place_order(
    body: TradeOrderRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await execute_trade(
        db=db,
        user=user,
        symbol=body.symbol,
        action=body.action,
        quantity=body.quantity,
        client_order_id=body.client_order_id,
    )
    # Broadcast updated price immediately so crowd buying surge appears live
    asyncio.create_task(ws_manager.broadcast_market(market_engine.build_tick_payload("PRICE_TICK")))
    return result


@app.get("/api/v1/portfolio/me")
async def my_portfolio(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await compute_user_portfolio(db, user.id)


# ---------------------------------------------------------------------------
# Admin Command Center (Live Telemetry + Real-Time Student Push)
# ---------------------------------------------------------------------------
@app.get("/api/v1/admin/overview")
async def admin_overview(_admin=Depends(verify_admin), db: AsyncSession = Depends(get_db)):
    return await compute_admin_overview(db)


@app.get("/api/v1/admin/user/{reg_no}")
async def admin_user_lookup(reg_no: str, _admin=Depends(verify_admin), db: AsyncSession = Depends(get_db)):
    clean_reg = reg_no.strip().upper()
    res = await db.execute(select(User).where(User.registration_no == clean_reg))
    user = res.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail=f"Registration {clean_reg} not found")

    portfolio = await compute_user_portfolio(db, user.id)
    tx_res = await db.execute(
        select(Transaction).where(Transaction.user_id == user.id).order_by(desc(Transaction.created_at)).limit(50)
    )
    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "registration_no": user.registration_no,
            "is_frozen": user.is_frozen,
        },
        "portfolio": portfolio,
        "transactions": [
            {
                "id": t.id,
                "symbol": t.symbol,
                "action": t.action,
                "quantity": t.quantity,
                "execution_price": float(t.execution_price),
                "total_amount": float(t.total_amount),
                "realized_pnl": float(t.realized_pnl),
                "created_at": t.created_at.isoformat(),
            }
            for t in tx_res.scalars().all()
        ],
    }


@app.post("/api/v1/admin/topup")
async def admin_topup(body: TopupRequest, _admin=Depends(verify_admin), db: AsyncSession = Depends(get_db)):
    clean_reg = body.registration_no.strip().upper()
    res = await db.execute(select(User).where(User.registration_no == clean_reg))
    user = res.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail=f"Student {clean_reg} not registered yet")

    wallet_res = await db.execute(select(Wallet).where(Wallet.user_id == user.id))
    wallet = wallet_res.scalar_one()
    amt = d2(body.amount)
    wallet.cash_balance = d2(wallet.cash_balance + amt)
    wallet.total_credited = d2(wallet.total_credited + amt)
    wallet.topup_count += 1

    db.add(AdminAuditLog(
        action_type="CASH_TOPUP",
        target_user_id=user.id,
        details=f"Credited +₹{amt} to {clean_reg} ({body.note})",
    ))
    await db.commit()

    portfolio = await compute_user_portfolio(db, user.id)
    delivered = await ws_manager.send_to_user(user.id, {
        "event": "CASH_TOPUP",
        "amount": float(amt),
        "message": f"Admin credited +₹{float(amt):,.2f} to your trading wallet!",
        "portfolio": portfolio,
    })

    return {
        "status": "TOPUP_SUCCESS",
        "registration_no": clean_reg,
        "credited_amount": float(amt),
        "new_cash_balance": float(wallet.cash_balance),
        "ws_delivered_tabs": delivered,
    }


@app.post("/api/v1/admin/user/freeze")
async def admin_freeze_user(body: FreezeUserRequest, _admin=Depends(verify_admin), db: AsyncSession = Depends(get_db)):
    clean_reg = body.registration_no.strip().upper()
    res = await db.execute(select(User).where(User.registration_no == clean_reg))
    user = res.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail=f"Student {clean_reg} not found")

    user.is_frozen = body.is_frozen
    state_label = "FROZEN" if body.is_frozen else "UNFROZEN"
    db.add(AdminAuditLog(
        action_type="ACCOUNT_STATUS",
        target_user_id=user.id,
        details=f"Set account {clean_reg} -> {state_label}",
    ))
    await db.commit()

    await ws_manager.send_to_user(user.id, {
        "event": "ACCOUNT_STATUS",
        "is_frozen": body.is_frozen,
        "message": "Your trading account was frozen by Admin." if body.is_frozen else "Your trading account has been restored by Admin.",
    })
    return {"registration_no": clean_reg, "is_frozen": body.is_frozen}


@app.post("/api/v1/admin/scenario/trigger")
async def admin_trigger_era(body: TriggerEraRequest, _admin=Depends(verify_admin), db: AsyncSession = Depends(get_db)):
    try:
        era = market_engine.trigger_era(body.era_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Persist era stocks & market settings atomically
    stocks_res = await db.execute(select(Stock))
    for srow in stocks_res.scalars().all():
        if srow.symbol in market_engine.stocks:
            st = market_engine.stocks[srow.symbol]
            srow.current_price = d2(st.current_price)
            srow.anchor_price = d2(st.anchor_price)

    ms_res = await db.execute(select(MarketSettings).where(MarketSettings.id == 1))
    ms = ms_res.scalar_one_or_none()
    if ms:
        ms.active_era_id = market_engine.active_era_id
        ms.active_scenario_name = market_engine.active_scenario_name
        ms.active_headline = market_engine.active_headline

    db.add(AdminAuditLog(action_type="ERA_TRIGGER", details=f"Triggered {era['name']}"))
    await db.commit()

    liquidations = await run_short_squeeze_supervisor(db)
    payload = market_engine.build_tick_payload("ERA_SHOCK")
    await ws_manager.broadcast_market(payload)

    return {
        "status": "ERA_APPLIED",
        "era": era["name"],
        "headline": era["headline"],
        "liquidations_triggered": len(liquidations),
    }


@app.post("/api/v1/admin/whale")
async def admin_inject_whale(body: WhaleOrderRequest, _admin=Depends(verify_admin), db: AsyncSession = Depends(get_db)):
    try:
        res = market_engine.inject_whale(body.symbol.upper(), body.side.upper(), body.quantity)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    db.add(AdminAuditLog(
        action_type="WHALE_ORDER",
        details=f"{body.side} {body.quantity} {body.symbol} (₹{res['before']} -> ₹{res['after']})",
    ))
    await db.commit()
    await ws_manager.broadcast_market(market_engine.build_tick_payload("WHALE_ALERT"))
    return res


@app.post("/api/v1/admin/price-override")
async def admin_price_override(body: PriceOverrideRequest, _admin=Depends(verify_admin), db: AsyncSession = Depends(get_db)):
    sym = body.symbol.upper()
    if sym not in market_engine.stocks:
        raise HTTPException(status_code=404, detail="Stock not found")
    new_p = market_engine.stocks[sym].force_price(body.target_price)
    db.add(AdminAuditLog(action_type="PRICE_OVERRIDE", details=f"Forced {sym} to ₹{new_p}"))
    await db.commit()
    await ws_manager.broadcast_market(market_engine.build_tick_payload("PRICE_TICK"))
    return {"symbol": sym, "price": new_p}


@app.patch("/api/v1/admin/market/pause")
async def admin_market_pause(body: MarketPauseRequest, _admin=Depends(verify_admin), db: AsyncSession = Depends(get_db)):
    market_engine.is_market_open = body.is_market_open
    ms_res = await db.execute(select(MarketSettings).where(MarketSettings.id == 1))
    ms = ms_res.scalar_one_or_none()
    if ms:
        ms.is_market_open = body.is_market_open
    db.add(AdminAuditLog(action_type="MARKET_STATUS", details=f"Market open={body.is_market_open}"))
    await db.commit()
    await ws_manager.broadcast_market(market_engine.build_tick_payload("MARKET_STATUS"))
    return {"is_market_open": market_engine.is_market_open}


@app.patch("/api/v1/admin/ticks/toggle")
async def admin_toggle_ticks(body: ToggleTicksRequest, _admin=Depends(verify_admin), db: AsyncSession = Depends(get_db)):
    market_engine.ticks_enabled = body.ticks_enabled
    ms_res = await db.execute(select(MarketSettings).where(MarketSettings.id == 1))
    ms = ms_res.scalar_one_or_none()
    if ms:
        ms.ticks_enabled = body.ticks_enabled
    await db.commit()
    await ws_manager.broadcast_market(market_engine.build_tick_payload("PRICE_TICK"))
    return {"ticks_enabled": market_engine.ticks_enabled}


@app.post("/api/v1/admin/broadcast")
async def admin_broadcast_headline(body: BroadcastHeadlineRequest, _admin=Depends(verify_admin), db: AsyncSession = Depends(get_db)):
    market_engine.active_headline = body.headline
    ms_res = await db.execute(select(MarketSettings).where(MarketSettings.id == 1))
    ms = ms_res.scalar_one_or_none()
    if ms:
        ms.active_headline = body.headline
    db.add(AdminAuditLog(action_type="GLOBAL_ALERT", details=body.headline))
    await db.commit()
    await ws_manager.broadcast_market(market_engine.build_tick_payload("GLOBAL_ALERT"))
    return {"active_headline": body.headline}


# ---------------------------------------------------------------------------
# System Snapshot & Warm-Standby Failover Endpoints
# ---------------------------------------------------------------------------
@app.get("/api/v1/system/snapshot")
async def system_snapshot(
    x_sync_secret: str | None = Header(default=None, alias="X-Sync-Secret"),
    x_admin_secret: str | None = Header(default=None, alias="X-Admin-Secret"),
    db: AsyncSession = Depends(get_db),
):
    valid_sync = x_sync_secret == settings.STANDBY_SYNC_SECRET
    valid_admin = x_admin_secret == settings.ADMIN_SECRET_KEY
    if not (valid_sync or valid_admin):
        raise HTTPException(status_code=403, detail="Unauthorized snapshot access")
    return await build_full_snapshot(db)


@app.post("/api/v1/system/restore")
async def system_restore(
    snapshot: dict,
    x_sync_secret: str | None = Header(default=None, alias="X-Sync-Secret"),
    x_admin_secret: str | None = Header(default=None, alias="X-Admin-Secret"),
    db: AsyncSession = Depends(get_db),
):
    valid_sync = x_sync_secret == settings.STANDBY_SYNC_SECRET
    valid_admin = x_admin_secret == settings.ADMIN_SECRET_KEY
    if not (valid_sync or valid_admin):
        raise HTTPException(status_code=403, detail="Unauthorized restore access")
    return await apply_snapshot_restore(db, snapshot)


# ---------------------------------------------------------------------------
# WebSockets (/ws/market & /ws/admin)
# ---------------------------------------------------------------------------
@app.websocket("/ws/market")
async def market_websocket(websocket: WebSocket, token: str | None = Query(default=None)):
    user_id: str | None = None
    if token:
        try:
            payload = decode_token(token)
            user_id = payload.get("sub")
        except HTTPException:
            user_id = None

    await ws_manager.connect_market(websocket, user_id=user_id)
    try:
        # Send immediate snapshot upon handshake so chart hydrates on zero wait
        initial = market_engine.build_tick_payload("SNAPSHOT")
        await websocket.send_text(dumps_json(initial))

        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
                mtype = msg.get("type")
                if mtype == "ping":
                    await websocket.send_text(dumps_json({"type": "pong", "ts": int(time.time() * 1000)}))
                elif mtype == "resync":
                    snap = market_engine.build_tick_payload("SNAPSHOT")
                    await websocket.send_text(dumps_json(snap))
            except Exception:
                pass
    except WebSocketDisconnect:
        ws_manager.disconnect_market(websocket)
    except Exception:
        ws_manager.disconnect_market(websocket)


@app.websocket("/ws/admin")
async def admin_websocket(websocket: WebSocket, secret: str = Query(default=""), token: str = Query(default="")):
    authorized = secret == settings.ADMIN_SECRET_KEY
    if not authorized and token:
        try:
            payload = decode_token(token)
            authorized = payload.get("role") == "ADMIN"
        except HTTPException:
            authorized = False

    if not authorized:
        await websocket.close(code=1008)
        return

    await ws_manager.connect_admin(websocket)
    try:
        async with AsyncSessionLocal() as db:
            overview = await compute_admin_overview(db)
            await websocket.send_text(dumps_json({"event": "ADMIN_TELEMETRY", "data": overview}))

        while True:
            raw = await websocket.receive_text()
            if '"ping"' in raw:
                await websocket.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        ws_manager.disconnect_admin(websocket)
    except Exception:
        ws_manager.disconnect_admin(websocket)
