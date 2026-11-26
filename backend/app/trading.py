"""Atomic Order Execution Engine, Anti-Exploit Guardrails, Rate Limiter & Short Squeeze Supervisor."""

from collections import defaultdict, deque
from decimal import Decimal, ROUND_HALF_UP
import time
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.market_engine import market_engine
from app.models import AdminAuditLog, Holding, Stock, Transaction, User, Wallet
from app.ws_manager import ws_manager

settings = get_settings()


def d2(val: float | Decimal | int) -> Decimal:
    return Decimal(str(val)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class UserRateLimiter:
    """Rate limit strictly by user_id (JWT claim), NEVER by IP due to auditorium NAT."""

    def __init__(self, window_sec: float, max_requests: int):
        self.window_sec = window_sec
        self.max_requests = max_requests
        self.events: dict[str, deque[float]] = defaultdict(deque)

    def check_or_raise(self, user_id: str) -> None:
        now = time.monotonic()
        q = self.events[user_id]
        while q and q[0] < now - self.window_sec:
            q.popleft()
        if len(q) >= self.max_requests:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Order rate limit exceeded. Wait a second before firing another trade.",
            )
        q.append(now)


order_rate_limiter = UserRateLimiter(
    window_sec=settings.ORDER_RATE_LIMIT_WINDOW_SEC,
    max_requests=settings.ORDER_RATE_LIMIT_MAX_ORDERS,
)


async def compute_user_portfolio(db: AsyncSession, user_id: str) -> dict:
    wallet_res = await db.execute(select(Wallet).where(Wallet.user_id == user_id))
    wallet = wallet_res.scalar_one_or_none()
    if wallet is None:
        raise HTTPException(status_code=404, detail="Wallet not found")

    holdings_res = await db.execute(select(Holding).where(Holding.user_id == user_id))
    holdings = holdings_res.scalars().all()

    long_value = Decimal("0.00")
    short_liability = Decimal("0.00")
    unrealized_pnl_total = Decimal("0.00")
    holding_items = []

    for h in holdings:
        live_price = d2(market_engine.stocks[h.symbol].current_price) if h.symbol in market_engine.stocks else d2(h.avg_entry_price)
        qty = Decimal(h.quantity)
        entry = d2(h.avg_entry_price)

        if h.position_type == "LONG":
            mkt_val = d2(qty * live_price)
            cost_basis = d2(qty * entry)
            upnl = d2(mkt_val - cost_basis)
            long_value += mkt_val
        else:
            mkt_val = d2(qty * live_price)
            cost_basis = d2(qty * entry)
            upnl = d2(cost_basis - mkt_val)
            short_liability += mkt_val

        unrealized_pnl_total += upnl
        holding_items.append({
            "symbol": h.symbol,
            "position_type": h.position_type,
            "quantity": h.quantity,
            "avg_entry_price": float(entry),
            "current_price": float(live_price),
            "market_value": float(mkt_val),
            "unrealized_pnl": float(upnl),
            "pnl_pct": round(float((upnl / cost_basis) * 100), 2) if cost_basis > 0 else 0.0,
        })

    cash = d2(wallet.cash_balance)
    collateral = d2(wallet.collateral_locked)
    net_worth = d2(cash + long_value + collateral - short_liability)

    return {
        "cash_balance": float(cash),
        "collateral_locked": float(collateral),
        "total_credited": float(wallet.total_credited),
        "topup_count": wallet.topup_count,
        "long_value": float(long_value),
        "short_liability": float(short_liability),
        "unrealized_pnl": float(unrealized_pnl_total),
        "net_worth": float(net_worth),
        "holdings": holding_items,
    }


async def execute_trade(
    db: AsyncSession,
    user: User,
    symbol: str,
    action: str,
    quantity: int,
    client_order_id: str,
) -> dict:
    action = action.upper()
    symbol = symbol.upper()

    if action not in ("BUY", "SELL", "SHORT", "COVER"):
        raise HTTPException(status_code=400, detail="Invalid trade action. Must be BUY, SELL, SHORT, or COVER.")
    if quantity <= 0 or quantity > settings.MAX_SHARES_PER_STOCK:
        raise HTTPException(status_code=400, detail=f"Quantity must be between 1 and {settings.MAX_SHARES_PER_STOCK}.")
    if symbol not in market_engine.stocks:
        raise HTTPException(status_code=404, detail=f"Ticker {symbol} not listed.")
    if not market_engine.is_market_open:
        raise HTTPException(status_code=503, detail="Market is temporarily paused by Admin.")
    if user.is_frozen:
        raise HTTPException(status_code=403, detail="Your trading account is frozen by Admin.")
    if user.status != "APPROVED":
        raise HTTPException(status_code=403, detail="Account pending admin approval.")

    # Idempotency check BEFORE acquiring locks / mutating state
    existing_tx_res = await db.execute(
        select(Transaction).where(Transaction.client_order_id == client_order_id)
    )
    existing_tx = existing_tx_res.scalar_one_or_none()
    if existing_tx is not None:
        portfolio = await compute_user_portfolio(db, user.id)
        return {
            "status": "FILLED",
            "idempotent_replay": True,
            "transaction_id": existing_tx.id,
            "symbol": existing_tx.symbol,
            "action": existing_tx.action,
            "quantity": existing_tx.quantity,
            "execution_price": float(existing_tx.execution_price),
            "total_amount": float(existing_tx.total_amount),
            "realized_pnl": float(existing_tx.realized_pnl),
            "portfolio": portfolio,
        }

    order_rate_limiter.check_or_raise(user.id)

    is_sqlite = db.bind.dialect.name == "sqlite" if db.bind else False

    # Lock wallet row FOR UPDATE on Postgres to prevent double-spend race conditions
    wallet_stmt = select(Wallet).where(Wallet.user_id == user.id)
    if not is_sqlite:
        wallet_stmt = wallet_stmt.with_for_update()
    wallet_res = await db.execute(wallet_stmt)
    wallet = wallet_res.scalar_one_or_none()
    if wallet is None:
        raise HTTPException(status_code=404, detail="Wallet not initialized")

    stock_res = await db.execute(select(Stock).where(Stock.symbol == symbol))
    stock_row = stock_res.scalar_one_or_none()
    if stock_row is None:
        raise HTTPException(status_code=404, detail="Stock record missing in DB")

    # Fetch user's current holdings to compute net worth & concentration cap
    holdings_stmt = select(Holding).where(Holding.user_id == user.id)
    if not is_sqlite:
        holdings_stmt = holdings_stmt.with_for_update()
    holdings_res = await db.execute(holdings_stmt)
    all_holdings = holdings_res.scalars().all()

    exec_price = d2(market_engine.stocks[symbol].current_price)
    qty_dec = Decimal(quantity)
    order_value = d2(exec_price * qty_dec)

    # Calculate current total portfolio net worth for 35% cap
    long_val = Decimal("0.00")
    short_liab = Decimal("0.00")
    current_long_holding: Holding | None = None
    current_short_holding: Holding | None = None

    for h in all_holdings:
        p = d2(market_engine.stocks[h.symbol].current_price) if h.symbol in market_engine.stocks else d2(h.avg_entry_price)
        if h.position_type == "LONG":
            long_val += d2(Decimal(h.quantity) * p)
            if h.symbol == symbol:
                current_long_holding = h
        else:
            short_liab += d2(Decimal(h.quantity) * p)
            if h.symbol == symbol:
                current_short_holding = h

    total_net_worth = d2(wallet.cash_balance + long_val + wallet.collateral_locked - short_liab)
    cap_basis = max(total_net_worth, d2(settings.STARTING_CASH))
    max_single_stock_val = d2(cap_basis * Decimal(str(settings.MAX_CONCENTRATION_PCT)))

    realized_pnl = Decimal("0.00")

    if action == "BUY":
        if wallet.cash_balance < order_value:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient cash. Need ₹{order_value}, available ₹{wallet.cash_balance}.",
            )
        existing_qty = current_long_holding.quantity if current_long_holding else 0
        post_qty = existing_qty + quantity
        if post_qty > settings.MAX_SHARES_PER_STOCK:
            raise HTTPException(
                status_code=400,
                detail=f"Exceeds 40-share cap per stock (holding {existing_qty}, requested +{quantity}).",
            )
        post_stock_value = d2(Decimal(post_qty) * exec_price)
        if post_stock_value > max_single_stock_val:
            raise HTTPException(
                status_code=400,
                detail=f"Exceeds 35% concentration limit (max ₹{max_single_stock_val} in {symbol}, order puts you at ₹{post_stock_value}).",
            )

        wallet.cash_balance = d2(wallet.cash_balance - order_value)
        if current_long_holding:
            old_total = d2(Decimal(current_long_holding.quantity) * current_long_holding.avg_entry_price)
            new_avg = d2((old_total + order_value) / Decimal(post_qty))
            current_long_holding.quantity = post_qty
            current_long_holding.avg_entry_price = new_avg
        else:
            db.add(Holding(
                user_id=user.id,
                stock_id=stock_row.id,
                symbol=symbol,
                position_type="LONG",
                quantity=quantity,
                avg_entry_price=exec_price,
            ))

    elif action == "SELL":
        if current_long_holding is None or current_long_holding.quantity < quantity:
            avail = current_long_holding.quantity if current_long_holding else 0
            raise HTTPException(status_code=400, detail=f"Insufficient shares to sell (holding {avail} of {symbol}).")

        realized_pnl = d2((exec_price - current_long_holding.avg_entry_price) * qty_dec)
        wallet.cash_balance = d2(wallet.cash_balance + order_value)
        if current_long_holding.quantity == quantity:
            await db.delete(current_long_holding)
        else:
            current_long_holding.quantity -= quantity

    elif action == "SHORT":
        if wallet.cash_balance < order_value:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient cash for 100% short collateral. Need ₹{order_value}, available ₹{wallet.cash_balance}.",
            )
        existing_qty = current_short_holding.quantity if current_short_holding else 0
        post_qty = existing_qty + quantity
        if post_qty > settings.MAX_SHARES_PER_STOCK:
            raise HTTPException(
                status_code=400,
                detail=f"Exceeds 40-share short cap (short {existing_qty}, requested +{quantity}).",
            )
        post_stock_value = d2(Decimal(post_qty) * exec_price)
        if post_stock_value > max_single_stock_val:
            raise HTTPException(
                status_code=400,
                detail=f"Exceeds 35% short concentration limit (max ₹{max_single_stock_val} in {symbol}).",
            )

        wallet.cash_balance = d2(wallet.cash_balance - order_value)
        wallet.collateral_locked = d2(wallet.collateral_locked + order_value)
        if current_short_holding:
            old_total = d2(Decimal(current_short_holding.quantity) * current_short_holding.avg_entry_price)
            new_avg = d2((old_total + order_value) / Decimal(post_qty))
            current_short_holding.quantity = post_qty
            current_short_holding.avg_entry_price = new_avg
        else:
            db.add(Holding(
                user_id=user.id,
                stock_id=stock_row.id,
                symbol=symbol,
                position_type="SHORT",
                quantity=quantity,
                avg_entry_price=exec_price,
            ))

    elif action == "COVER":
        if current_short_holding is None or current_short_holding.quantity < quantity:
            avail = current_short_holding.quantity if current_short_holding else 0
            raise HTTPException(status_code=400, detail=f"No open short position to cover (short {avail} of {symbol}).")

        entry_price = d2(current_short_holding.avg_entry_price)
        locked_for_portion = d2(entry_price * qty_dec)
        realized_pnl = d2((entry_price - exec_price) * qty_dec)
        returned_cash = max(Decimal("0.00"), d2(locked_for_portion + realized_pnl))

        wallet.collateral_locked = max(Decimal("0.00"), d2(wallet.collateral_locked - locked_for_portion))
        wallet.cash_balance = d2(wallet.cash_balance + returned_cash)

        if current_short_holding.quantity == quantity:
            await db.delete(current_short_holding)
        else:
            current_short_holding.quantity -= quantity

    tx = Transaction(
        client_order_id=client_order_id,
        user_id=user.id,
        stock_id=stock_row.id,
        symbol=symbol,
        action=action,
        quantity=quantity,
        execution_price=exec_price,
        total_amount=order_value,
        realized_pnl=realized_pnl,
    )
    db.add(tx)
    await db.commit()

    # Apply AMM price impact in RAM immediately after atomic DB commit succeeds.
    # Avoid locking the global stocks row on every student trade; background sync persists prices.
    new_price = market_engine.stocks[symbol].record_trade_impact(action, quantity)
    market_engine.record_order_throughput()

    portfolio = await compute_user_portfolio(db, user.id)
    return {
        "status": "FILLED",
        "idempotent_replay": False,
        "transaction_id": tx.id,
        "symbol": symbol,
        "action": action,
        "quantity": quantity,
        "execution_price": float(exec_price),
        "post_trade_market_price": new_price,
        "total_amount": float(order_value),
        "realized_pnl": float(realized_pnl),
        "portfolio": portfolio,
    }


async def run_short_squeeze_supervisor(db: AsyncSession) -> list[dict]:
    """Forced +80% cover check so short sellers cannot go deeply negative."""
    res = await db.execute(select(Holding).where(Holding.position_type == "SHORT"))
    short_holdings = res.scalars().all()
    liquidations: list[dict] = []

    for h in short_holdings:
        if h.symbol not in market_engine.stocks:
            continue
        cur_price = d2(market_engine.stocks[h.symbol].current_price)
        entry_price = d2(h.avg_entry_price)
        threshold = d2(entry_price * Decimal(str(settings.SHORT_SQUEEZE_THRESHOLD)))
        if cur_price >= threshold:
            wallet_res = await db.execute(select(Wallet).where(Wallet.user_id == h.user_id))
            wallet = wallet_res.scalar_one_or_none()
            if wallet is None:
                continue
            qty_dec = Decimal(h.quantity)
            locked_portion = d2(entry_price * qty_dec)
            pnl = d2((entry_price - cur_price) * qty_dec)
            returned = max(Decimal("0.00"), d2(locked_portion + pnl))
            wallet.collateral_locked = max(Decimal("0.00"), d2(wallet.collateral_locked - locked_portion))
            wallet.cash_balance = d2(wallet.cash_balance + returned)

            tx = Transaction(
                client_order_id=f"squeeze-{h.id}-{int(time.time()*1000)}",
                user_id=h.user_id,
                stock_id=h.stock_id,
                symbol=h.symbol,
                action="LIQUIDATE",
                quantity=h.quantity,
                execution_price=cur_price,
                total_amount=d2(cur_price * qty_dec),
                realized_pnl=pnl,
            )
            db.add(tx)
            db.add(AdminAuditLog(
                action_type="SHORT_SQUEEZE_LIQUIDATION",
                target_user_id=h.user_id,
                details=f"Auto-liquidated {h.quantity} short {h.symbol} @ ₹{cur_price} (entry ₹{entry_price})",
            ))
            await db.delete(h)
            liquidations.append({
                "user_id": h.user_id,
                "symbol": h.symbol,
                "qty": h.quantity,
                "price": float(cur_price),
                "pnl": float(pnl),
            })

    if liquidations:
        await db.commit()
        for liq in liquidations:
            await ws_manager.send_to_user(liq["user_id"], {
                "event": "FORCED_LIQUIDATION",
                "data": liq,
            })

    return liquidations
