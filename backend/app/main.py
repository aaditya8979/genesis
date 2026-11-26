"""GENESIS 2026 Virtual Stock Exchange — FastAPI + Single-Worker uvloop Application."""

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from decimal import Decimal
import json
import logging
import time

from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel, EmailStr, Field
import random
from sqlalchemy import desc, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import create_access_token, decode_token, get_current_user, verify_admin
from app.backup_manager import (
    apply_snapshot_restore,
    build_full_snapshot,
    execute_full_backup_cycle,
    get_backup_status,
    pull_latest_from_supabase,
    request_background_backup,
    snapshot_exporter_loop,
    startup_auto_recover,
)
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


class VolatilityRegimeRequest(BaseModel):
    regime: str = Field(..., pattern="^(CALM|DYNAMIC|FRENZY)$")
    simulate_flow: bool = True


class RealUserImportItem(BaseModel):
    email: EmailStr
    registration_no: str = Field(..., min_length=3, max_length=50)
    full_name: str = Field(default="", max_length=150)


class BulkImportRealUsersRequest(BaseModel):
    participants: list[RealUserImportItem] = Field(..., min_length=1, max_length=1500)
    starting_cash: float = Field(default=25000.0, gt=0, le=500000)


class CohortUpdateRequest(BaseModel):
    registration_no: str = Field(..., min_length=2, max_length=50)
    cohort: str = Field(..., pattern="^(REAL|DUMMY)$")


# ---------------------------------------------------------------------------
# Database Seeding & Snapshot Persistence Helpers
# ---------------------------------------------------------------------------
DUMMY_ROSTER_NAMES = [
    "Aarav Mehta", "Vihaan Rao", "Ishaan Nair", "Kabir Menon", "Reyansh Kapoor",
    "Advaith Iyer", "Vivaan Joshi", "Arjun Bansal", "Sai Krishnan", "Devansh Gupta",
    "Anika Deshmukh", "Diya Sengupta", "Myra Chatterjee", "Sara Kulkarni", "Kavya Tiwari",
    "Rhea Chauhan", "Pari Malhotra", "Naina Aggarwal", "Ira Chatterjee", "Tara Siddiqui",
    "Rohan Saxena", "Pranav Mishra", "Karthik Reddy", "Siddharth Jain", "Harshvardhan Goel",
    "Nikhil Grover", "Yashwant Kumar", "Gaurav Shetty", "Manav Verma", "Tanishq Bhatia",
    "Sneha Pillai", "Meera Hegde", "Nandini Dubey", "Simran Gill", "Shruti Pathak",
    "Varun Khanna", "Ayushman Roy", "Rishabh Sinha", "Tejas Patel", "Omkar Kulkarni",
]


async def ensure_schema_migrations(conn) -> None:
    """Idempotently add new columns (cohort) on existing Postgres/SQLite databases."""
    dialect = conn.dialect.name
    if dialect == "sqlite":
        cols_res = await conn.execute(text("PRAGMA table_info(users)"))
        existing_cols = {row[1] for row in cols_res.fetchall()}
        if "cohort" not in existing_cols:
            await conn.execute(text("ALTER TABLE users ADD COLUMN cohort VARCHAR(20) NOT NULL DEFAULT 'REAL'"))
    else:
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS cohort VARCHAR(20) NOT NULL DEFAULT 'REAL'"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_cohort ON users (cohort)"))


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
            await db.flush()
            existing_stocks_res = await db.execute(select(Stock))
            existing_stocks = {s.symbol: s for s in existing_stocks_res.scalars().all()}
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

        # Reclassify synthetic stress/verification accounts cleanly into DUMMY cohort
        all_users_res = await db.execute(select(User))
        existing_regs: set[str] = set()
        for existing_u in all_users_res.scalars().all():
            existing_regs.add(existing_u.registration_no)
            if (
                existing_u.registration_no.startswith("25STR")
                or existing_u.registration_no.startswith("25DMY")
                or existing_u.registration_no == "24BCE9001"
                or existing_u.email.startswith("stress")
                or existing_u.email.startswith("dummy")
            ):
                existing_u.cohort = "DUMMY"

        # Seed 40 realistic Dummy Simulation Bots isolated in DUMMY cohort
        if "25DMY0001" not in existing_regs and existing_stocks:
            rng = random.Random(202604)
            stock_syms = list(existing_stocks.keys())
            for idx, full_name in enumerate(DUMMY_ROSTER_NAMES, start=1):
                reg_no = f"25DMY{idx:04d}"
                if reg_no in existing_regs:
                    continue
                email = f"sim.bot{idx:02d}@dummy.genesis2026.in"
                dummy_user = User(
                    email=email,
                    registration_no=reg_no,
                    full_name=full_name,
                    role="PARTICIPANT",
                    cohort="DUMMY",
                    status="APPROVED",
                    is_frozen=False,
                )
                db.add(dummy_user)
                await db.flush()

                pick_syms = rng.sample(stock_syms, k=min(3, len(stock_syms)))
                cash_left = Decimal(str(settings.STARTING_CASH))
                for sym in pick_syms:
                    st_row = existing_stocks[sym]
                    live_p = float(market_engine.stocks[sym].current_price) if sym in market_engine.stocks else float(st_row.current_price)
                    qty = rng.randint(4, 18)
                    cost = d2(live_p * qty)
                    if cost <= cash_left * Decimal("0.32"):
                        entry_p = d2(live_p * rng.uniform(0.92, 1.07))
                        cash_left = d2(cash_left - d2(entry_p * Decimal(qty)))
                        db.add(Holding(
                            user_id=dummy_user.id,
                            stock_id=st_row.id,
                            symbol=sym,
                            position_type="LONG",
                            quantity=qty,
                            avg_entry_price=entry_p,
                        ))

                db.add(Wallet(
                    user_id=dummy_user.id,
                    cash_balance=cash_left,
                    collateral_locked=Decimal("0.00"),
                    total_credited=d2(settings.STARTING_CASH),
                    topup_count=0,
                ))

        await db.commit()


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
    real_count = 0
    real_cash_pool = Decimal("0.00")
    real_net_worth_pool = Decimal("0.00")
    dummy_count = 0
    dummy_cash_pool = Decimal("0.00")
    dummy_net_worth_pool = Decimal("0.00")
    participants = []

    for u in users:
        w = wallets.get(u.id)
        if not w:
            continue
        cash = d2(w.cash_balance)
        collat = d2(w.collateral_locked)
        total_credited = d2(w.total_credited)
        total_cash_circulation += cash + collat

        long_val = Decimal("0.00")
        short_liab = Decimal("0.00")
        short_unrealized = Decimal("0.00")
        long_unrealized = Decimal("0.00")
        u_holdings = holdings_by_user.get(u.id, [])
        for h in u_holdings:
            p = d2(market_engine.stocks[h.symbol].current_price) if h.symbol in market_engine.stocks else d2(h.avg_entry_price)
            if h.position_type == "LONG":
                val = d2(Decimal(h.quantity) * p)
                long_val += val
                long_unrealized += d2((p - d2(h.avg_entry_price)) * Decimal(h.quantity))
            else:
                short_liab += d2(Decimal(h.quantity) * p)
                short_unrealized += d2((d2(h.avg_entry_price) - p) * Decimal(h.quantity))

        unrealized_pnl = d2(long_unrealized + short_unrealized)
        net_worth = d2(cash + long_val + collat + short_unrealized)
        net_pnl = d2(net_worth - total_credited)
        net_return_pct = float(round((net_pnl / total_credited) * Decimal("100"), 2)) if total_credited > 0 else 0.0
        cohort = getattr(u, "cohort", "REAL") or "REAL"

        if cohort == "DUMMY":
            dummy_count += 1
            dummy_cash_pool += cash + collat
            dummy_net_worth_pool += net_worth
        else:
            real_count += 1
            real_cash_pool += cash + collat
            real_net_worth_pool += net_worth

        participants.append({
            "user_id": u.id,
            "email": u.email,
            "registration_no": u.registration_no,
            "full_name": u.full_name,
            "cohort": cohort,
            "is_frozen": u.is_frozen,
            "cash_balance": float(cash),
            "collateral_locked": float(collat),
            "holdings_value": float(long_val),
            "short_liability": float(short_liab),
            "unrealized_pnl": float(unrealized_pnl),
            "total_credited": float(total_credited),
            "topup_count": w.topup_count,
            "net_worth": float(net_worth),
            "net_pnl": float(net_pnl),
            "net_return_pct": net_return_pct,
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
        "cohort_summary": {
            "real_count": real_count,
            "real_cash_pool": float(real_cash_pool),
            "real_net_worth_pool": float(real_net_worth_pool),
            "dummy_count": dummy_count,
            "dummy_cash_pool": float(dummy_cash_pool),
            "dummy_net_worth_pool": float(dummy_net_worth_pool),
        },
        "is_market_open": market_engine.is_market_open,
        "ticks_enabled": market_engine.ticks_enabled,
        "volatility_regime": market_engine.volatility_regime,
        "simulate_flow_enabled": market_engine.simulate_flow_enabled,
        "active_era_id": market_engine.active_era_id,
        "active_scenario_name": market_engine.active_scenario_name,
        "active_headline": market_engine.active_headline,
        "event_feed": list(market_engine.event_feed),
        "chart_markers": list(market_engine.chart_markers),
        "participants": participants,
        "top_exposure": top_stocks_exposure,
        "recent_logs": logs,
        "backup_status": get_backup_status(),
        "eras": [
            {"id": e["id"], "order": e["order"], "name": e["name"], "severity": e["severity"]}
            for e in sorted(SCENARIOS_MAP.values(), key=lambda x: x["order"])
        ],
    }


# ---------------------------------------------------------------------------
# Background Tasks: Coalesced Broadcaster, Tick Loop & Warm-Standby Exporter
# ---------------------------------------------------------------------------
_trade_dirty_event = asyncio.Event()


async def coalesced_trade_broadcaster() -> None:
    """Coalesce rapid order bursts (e.g. 400 trades in 1s) into at most 1 broadcast every 150ms."""
    while True:
        try:
            await _trade_dirty_event.wait()
            # Small batch window to coalesce simultaneous fills
            await asyncio.sleep(0.15)
            _trade_dirty_event.clear()
            payload = market_engine.build_tick_payload("PRICE_TICK")
            await ws_manager.broadcast_market(payload)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.exception("Error in coalesced_trade_broadcaster: %s", exc)


async def market_tick_loop() -> None:
    tick_count = 0
    while True:
        try:
            await asyncio.sleep(settings.TICK_INTERVAL_SECONDS)
            tick_count += 1
            # Tick market dynamics on every 1s cycle for lively, realistic Upstox/Zerodha candle action
            market_engine.step_jitter_if_enabled()

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await ensure_schema_migrations(conn)
    await seed_initial_data()
    recovered = await startup_auto_recover()
    if recovered:
        logger.info("Startup auto-recovery applied: %s", recovered)

    tick_task = asyncio.create_task(market_tick_loop())
    broadcaster_task = asyncio.create_task(coalesced_trade_broadcaster())
    snap_task = asyncio.create_task(snapshot_exporter_loop())
    logger.info("GENESIS 2026 Exchange Engine online (30 equities, 10 eras, single-worker RAM mode)")
    try:
        yield
    finally:
        tick_task.cancel()
        broadcaster_task.cancel()
        snap_task.cancel()
        await asyncio.gather(tick_task, broadcaster_task, snap_task, return_exceptions=True)


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
            cohort="REAL",
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
        "volatility_regime": market_engine.volatility_regime,
        "simulate_flow_enabled": market_engine.simulate_flow_enabled,
        "active_era_id": market_engine.active_era_id,
        "active_scenario_name": market_engine.active_scenario_name,
        "active_headline": market_engine.active_headline,
        "event_feed": list(market_engine.event_feed),
        "chart_markers": list(market_engine.chart_markers),
        "user": {
            "id": user.id,
            "email": user.email,
            "registration_no": user.registration_no,
            "full_name": user.full_name,
            "cohort": getattr(user, "cohort", "REAL"),
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
    # Signal coalesced broadcaster instead of spawning N broadcasts for N simultaneous orders
    _trade_dirty_event.set()
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


@app.get("/api/v1/admin/tally")
async def admin_cohort_tally(_admin=Depends(verify_admin), db: AsyncSession = Depends(get_db)):
    """Separate official tally & ledger export for Real Participants vs Dummy Bots."""
    overview = await compute_admin_overview(db)
    real_tally = [p for p in overview["participants"] if p["cohort"] == "REAL"]
    dummy_tally = [p for p in overview["participants"] if p["cohort"] == "DUMMY"]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": overview["cohort_summary"],
        "real_tally": real_tally,
        "dummy_tally": dummy_tally,
    }


@app.post("/api/v1/admin/users/import-real")
async def admin_import_real_users(
    body: BulkImportRealUsersRequest,
    _admin=Depends(verify_admin),
    db: AsyncSession = Depends(get_db),
):
    """Pre-register or upsert Real Participants directly into the isolated REAL cohort."""
    created = 0
    updated = 0
    starting = d2(body.starting_cash)

    for item in body.participants:
        email = item.email.strip().lower()
        reg_no = item.registration_no.strip().upper()
        name_val = (item.full_name or reg_no).strip()

        res_reg = await db.execute(select(User).where(User.registration_no == reg_no))
        user = res_reg.scalar_one_or_none()
        if user is None:
            res_email = await db.execute(select(User).where(User.email == email))
            user = res_email.scalar_one_or_none()

        if user is not None:
            user.email = email
            user.registration_no = reg_no
            if item.full_name:
                user.full_name = name_val
            user.cohort = "REAL"
            user.status = "APPROVED"
            updated += 1
        else:
            user = User(
                email=email,
                registration_no=reg_no,
                full_name=name_val,
                role="PARTICIPANT",
                cohort="REAL",
                status="APPROVED",
                is_frozen=False,
            )
            db.add(user)
            await db.flush()
            db.add(Wallet(
                user_id=user.id,
                cash_balance=starting,
                collateral_locked=Decimal("0.00"),
                total_credited=starting,
                topup_count=0,
            ))
            created += 1

    db.add(AdminAuditLog(
        action_type="IMPORT_REAL_USERS",
        details=f"Imported/updated REAL cohort (created={created}, updated={updated})",
    ))
    await db.commit()
    request_background_backup(checkpoint=True)
    return {"status": "IMPORTED", "created": created, "updated": updated}


@app.patch("/api/v1/admin/user/cohort")
async def admin_set_user_cohort(
    body: CohortUpdateRequest,
    _admin=Depends(verify_admin),
    db: AsyncSession = Depends(get_db),
):
    clean_reg = body.registration_no.strip().upper()
    res = await db.execute(select(User).where(User.registration_no == clean_reg))
    user = res.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail=f"User {clean_reg} not found")
    user.cohort = body.cohort
    db.add(AdminAuditLog(
        action_type="COHORT_UPDATE",
        target_user_id=user.id,
        details=f"Moved {clean_reg} to cohort={body.cohort}",
    ))
    await db.commit()
    return {"registration_no": clean_reg, "cohort": user.cohort}


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
            "full_name": user.full_name,
            "cohort": getattr(user, "cohort", "REAL"),
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
    request_background_backup(checkpoint=False)

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
    request_background_backup(checkpoint=True)

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
    request_background_backup(checkpoint=True)
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
    market_engine.add_broadcast_event(body.headline)
    ms_res = await db.execute(select(MarketSettings).where(MarketSettings.id == 1))
    ms = ms_res.scalar_one_or_none()
    if ms:
        ms.active_headline = body.headline
    db.add(AdminAuditLog(action_type="GLOBAL_ALERT", details=body.headline))
    await db.commit()
    await ws_manager.broadcast_market(market_engine.build_tick_payload("GLOBAL_ALERT"))
    return {"active_headline": body.headline}


@app.patch("/api/v1/admin/volatility")
async def admin_set_volatility(body: VolatilityRegimeRequest, _admin=Depends(verify_admin), db: AsyncSession = Depends(get_db)):
    market_engine.set_volatility_regime(body.regime, body.simulate_flow)
    db.add(AdminAuditLog(
        action_type="VOLATILITY_REGIME",
        details=f"Set market regime={body.regime}, simulate_flow={body.simulate_flow}",
    ))
    await db.commit()
    await ws_manager.broadcast_market(market_engine.build_tick_payload("PRICE_TICK"))
    return {"volatility_regime": body.regime, "simulate_flow": body.simulate_flow}


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
    res = await apply_snapshot_restore(db, snapshot)
    await ws_manager.broadcast_market(market_engine.build_tick_payload("SNAPSHOT"))
    return res


@app.get("/api/v1/system/backup/status")
async def system_backup_status(
    x_sync_secret: str | None = Header(default=None, alias="X-Sync-Secret"),
    x_admin_secret: str | None = Header(default=None, alias="X-Admin-Secret"),
):
    valid_sync = x_sync_secret == settings.STANDBY_SYNC_SECRET
    valid_admin = x_admin_secret == settings.ADMIN_SECRET_KEY
    if not (valid_sync or valid_admin):
        raise HTTPException(status_code=403, detail="Unauthorized backup status access")
    return get_backup_status()


@app.post("/api/v1/system/backup/now")
async def system_backup_now(_admin=Depends(verify_admin)):
    result = await execute_full_backup_cycle(save_checkpoint=True)
    return {"backup": result, "status": get_backup_status()}


@app.post("/api/v1/system/backup/restore-supabase")
async def system_restore_from_supabase(_admin=Depends(verify_admin), db: AsyncSession = Depends(get_db)):
    snap = await pull_latest_from_supabase()
    if not snap:
        raise HTTPException(
            status_code=404,
            detail="No snapshot found in Supabase Vault (check SUPABASE_DB_URL / SUPABASE_URL & SUPABASE_SERVICE_KEY).",
        )
    res = await apply_snapshot_restore(db, snap)
    await ws_manager.broadcast_market(market_engine.build_tick_payload("SNAPSHOT"))
    return {"source": "SUPABASE_VAULT", **res}


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
