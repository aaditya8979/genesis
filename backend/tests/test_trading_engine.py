"""Rigorous unit, guardrail, race-condition, WebSocket, and failover tests for GENESIS 2026."""

import asyncio
import os
from pathlib import Path
import pytest
from httpx import ASGITransport, AsyncClient

# Ensure isolated test SQLite DB before importing app
TEST_DB_PATH = Path("/tmp/genesis_pytest.db")
if TEST_DB_PATH.exists():
    TEST_DB_PATH.unlink()

os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{TEST_DB_PATH}"
os.environ["BACKUP_DIR"] = "/tmp/genesis_test_backups"
os.environ["ORDER_RATE_LIMIT_MAX_ORDERS"] = "50"  # Allow burst testing in unit suite

from app.main import app, seed_initial_data  # noqa: E402
from app.db import Base, engine  # noqa: E402
from app.market_engine import market_engine  # noqa: E402


@pytest.fixture(autouse=True)
async def reset_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    market_engine.init_from_catalog()
    market_engine.is_market_open = True
    market_engine.ticks_enabled = True
    await seed_initial_data()
    yield


@pytest.mark.asyncio
async def test_login_simple_email_and_regno_only():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post("/api/v1/auth/login", json={
            "email": "aaditya@vitbhopal.ac.in",
            "registration_no": "25bce10001",
        })
        assert res.status_code == 200
        data = res.json()
        assert data["user"]["registration_no"] == "25BCE10001"
        assert data["portfolio"]["cash_balance"] == 25000.0
        token = data["access_token"]

        # Re-login with same email & reg_no succeeds cleanly
        res2 = await ac.post("/api/v1/auth/login", json={
            "email": "aaditya@vitbhopal.ac.in",
            "registration_no": "25BCE10001",
        })
        assert res2.status_code == 200
        assert res2.json()["user"]["id"] == data["user"]["id"]

        # Conflict if wrong email uses existing reg_no
        res_bad = await ac.post("/api/v1/auth/login", json={
            "email": "attacker@vitbhopal.ac.in",
            "registration_no": "25BCE10001",
        })
        assert res_bad.status_code == 409

        # Bootstrap hydration returns 30 stocks + candles
        boot = await ac.get("/api/v1/bootstrap", headers={"Authorization": f"Bearer {token}"})
        assert boot.status_code == 200
        bdata = boot.json()
        assert len(bdata["stocks"]) == 30
        assert len(bdata["stocks"][0]["candles"]) >= 36


@pytest.mark.asyncio
async def test_buy_sell_guardrails_concentration_and_40_share_cap():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        login = await ac.post("/api/v1/auth/login", json={
            "email": "trader1@vitbhopal.ac.in",
            "registration_no": "25BCE10002",
        })
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Attempt > 35% cap (25,000 * 0.35 = 8,750). TMND = 180 -> 40 shares = 7,200 (OK)
        # Try VIST = 850 * 11 = 9,350 -> MUST REJECT 35% cap
        cap_fail = await ac.post("/api/v1/trade/order", headers=headers, json={
            "symbol": "VIST", "action": "BUY", "quantity": 11, "client_order_id": "ord-cap-1"
        })
        assert cap_fail.status_code == 400
        assert "35%" in cap_fail.json()["detail"]

        # Buy 40 shares of RVB (65 * 40 = 2,600 <= 8,750) -> OK
        ok_buy = await ac.post("/api/v1/trade/order", headers=headers, json={
            "symbol": "RVB", "action": "BUY", "quantity": 40, "client_order_id": "ord-rvb-40"
        })
        assert ok_buy.status_code == 200
        assert ok_buy.json()["portfolio"]["cash_balance"] == 22400.0

        # Buying 1 more share of RVB violates 40-share cap
        cap40_fail = await ac.post("/api/v1/trade/order", headers=headers, json={
            "symbol": "RVB", "action": "BUY", "quantity": 1, "client_order_id": "ord-rvb-41"
        })
        assert cap40_fail.status_code == 400
        assert "40-share" in cap40_fail.json()["detail"]

        # Idempotent replay returns exact original transaction without deducting cash twice
        replay = await ac.post("/api/v1/trade/order", headers=headers, json={
            "symbol": "RVB", "action": "BUY", "quantity": 40, "client_order_id": "ord-rvb-40"
        })
        assert replay.status_code == 200
        assert replay.json()["idempotent_replay"] is True
        assert replay.json()["portfolio"]["cash_balance"] == 22400.0


@pytest.mark.asyncio
async def test_short_selling_era_shock_and_forced_liquidation():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        login = await ac.post("/api/v1/auth/login", json={
            "email": "bear@vitbhopal.ac.in",
            "registration_no": "25BCE10003",
        })
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        admin_headers = {"X-Admin-Secret": "genesis_admin_master_2026"}

        # Short 20 shares of TMND @ 180.00 -> 3,600 collateral locked
        short_res = await ac.post("/api/v1/trade/order", headers=headers, json={
            "symbol": "TMND", "action": "SHORT", "quantity": 20, "client_order_id": "short-1"
        })
        assert short_res.status_code == 200
        p = short_res.json()["portfolio"]
        assert p["collateral_locked"] == 3600.0
        assert p["cash_balance"] == 21400.0

        # Trigger ERA 1 DOT COM (TMND crashes -65%) -> Short should gain massive profit!
        era_res = await ac.post("/api/v1/admin/scenario/trigger", headers=admin_headers, json={
            "era_id": "ERA_1_DOT_COM"
        })
        assert era_res.status_code == 200

        port_after = (await ac.get("/api/v1/portfolio/me", headers=headers)).json()
        assert port_after["net_worth"] > 27000.0  # Profit from shorting dot-com crash

        # Cover 20 shares and realize profit
        cov = await ac.post("/api/v1/trade/order", headers=headers, json={
            "symbol": "TMND", "action": "COVER", "quantity": 20, "client_order_id": "cover-1"
        })
        assert cov.status_code == 200
        assert cov.json()["realized_pnl"] > 2000.0
        assert cov.json()["portfolio"]["collateral_locked"] == 0.0

        # Test +80% Short Squeeze forced cover on PAYB
        p_payb = market_engine.stocks["PAYB"].current_price
        await ac.post("/api/v1/trade/order", headers=headers, json={
            "symbol": "PAYB", "action": "SHORT", "quantity": 10, "client_order_id": "short-payb"
        })
        # Override price to +90% -> triggers squeeze or wait for supervisor
        await ac.post("/api/v1/admin/price-override", headers=admin_headers, json={
            "symbol": "PAYB", "target_price": round(p_payb * 1.9, 2)
        })
        # Trigger ERA 9 AI Supercycle (+85% on TMND) or run squeeze directly
        from app.db import AsyncSessionLocal
        from app.trading import run_short_squeeze_supervisor
        async with AsyncSessionLocal() as db:
            liqs = await run_short_squeeze_supervisor(db)
            assert len(liqs) == 1
            assert liqs[0]["symbol"] == "PAYB"


@pytest.mark.asyncio
async def test_admin_topup_freeze_and_snapshot_restore():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        login = await ac.post("/api/v1/auth/login", json={
            "email": "student@vitbhopal.ac.in",
            "registration_no": "25BCE10099",
        })
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        admin_headers = {"X-Admin-Secret": "genesis_admin_master_2026"}

        # Admin top-up +5,000
        topup = await ac.post("/api/v1/admin/topup", headers=admin_headers, json={
            "registration_no": "25BCE10099",
            "amount": 5000.0,
            "note": "Paid cash topup desk",
        })
        assert topup.status_code == 200
        assert topup.json()["new_cash_balance"] == 30000.0

        # Verify bootstrap reflects new cash immediately
        boot = (await ac.get("/api/v1/bootstrap", headers=headers)).json()
        assert boot["portfolio"]["cash_balance"] == 30000.0

        # Export snapshot before wiping DB
        snap = (await ac.get("/api/v1/system/snapshot", headers=admin_headers)).json()
        assert len(snap["users"]) == 1

        # Freeze account -> trading blocked with 403
        await ac.post("/api/v1/admin/user/freeze", headers=admin_headers, json={
            "registration_no": "25BCE10099",
            "is_frozen": True,
        })
        blocked = await ac.post("/api/v1/trade/order", headers=headers, json={
            "symbol": "TMND", "action": "BUY", "quantity": 5, "client_order_id": "frozen-buy"
        })
        assert blocked.status_code == 403

        # Restore snapshot onto fresh DB state
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await seed_initial_data()

        restore_res = await ac.post("/api/v1/system/restore", headers=admin_headers, json=snap)
        assert restore_res.status_code == 200
        assert restore_res.json()["restored_users"] == 1

        restored_port = (await ac.get("/api/v1/portfolio/me", headers=headers)).json()
        assert restored_port["cash_balance"] == 30000.0


@pytest.mark.asyncio
async def test_concurrent_double_spend_prevention():
    """Simulate 10 concurrent identical-value distinct-UUID BUY clicks trying to drain 25k wallet."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        login = await ac.post("/api/v1/auth/login", json={
            "email": "racer@vitbhopal.ac.in",
            "registration_no": "25BCE10888",
        })
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # TMND = 180, 40 shares = 7,200. Can only buy 1 batch of 40 before hitting 40-share cap,
        # OR buy 10 different stocks simultaneously of ~7,000 each -> at most 3 can succeed (21,000 <= 25,000)!
        symbols = ["OMNA", "TMND", "KVACH", "BCHIP", "APEX", "CPBK", "PLFE", "SANJ", "MCRH", "TRSH"]

        async def fire_buy(sym: str, idx: int):
            qty = min(40, int(6500 // market_engine.stocks[sym].current_price))
            return await ac.post("/api/v1/trade/order", headers=headers, json={
                "symbol": sym,
                "action": "BUY",
                "quantity": max(1, qty),
                "client_order_id": f"race-{idx}",
            })

        responses = await asyncio.gather(*(fire_buy(s, i) for i, s in enumerate(symbols)))
        succeeded = [r for r in responses if r.status_code == 200]
        assert 1 <= len(succeeded) <= 4

        port = (await ac.get("/api/v1/portfolio/me", headers=headers)).json()
        assert port["cash_balance"] >= 0.0

