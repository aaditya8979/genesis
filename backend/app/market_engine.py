"""In-Memory Authoritative Market State, OHLC Candle Aggregator, AMM Pricing & Tick Loop."""

from collections import deque
from dataclasses import dataclass, field
import math
import random
import time

from app.config import get_settings
from app.scenarios_config import SCENARIOS_MAP, STOCKS_CATALOG

settings = get_settings()

CANDLE_INTERVAL_SEC = 5  # Base 5-second bars; UI can aggregate into 5s / 15s / 1m


def align_bucket(ts_sec: int, interval: int = CANDLE_INTERVAL_SEC) -> int:
    return (ts_sec // interval) * interval


@dataclass
class CandleBar:
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: int = 0

    def to_dict(self) -> dict:
        return {
            "time": self.time,
            "open": round(self.open, 2),
            "high": round(self.high, 2),
            "low": round(self.low, 2),
            "close": round(self.close, 2),
            "volume": self.volume,
        }


@dataclass
class StockRuntimeState:
    symbol: str
    company_name: str
    sector: str
    pe_ratio: float
    base_price: float
    anchor_price: float
    current_price: float
    prev_price: float
    volatility: float
    liquidity_depth: float
    era_open_price: float
    total_volume: int = 0
    # Rolling 30-second order flow events: (timestamp_float, side 'BUY'|'SELL', qty)
    flow_window: deque = field(default_factory=deque)
    # Historical 5-second OHLC candles (ring buffer of 360 bars = 30 mins of high-res history)
    candles: deque = field(default_factory=lambda: deque(maxlen=360))

    def seed_history(self, now_sec: int) -> None:
        """Seed 360 realistic 5s bars (30 mins) ending at current_price so 5s/15s/30s/1m charts all render full density immediately."""
        if self.candles:
            return
        cur_bucket = align_bucket(now_sec)
        p = self.base_price
        rng = random.Random(hash(self.symbol) & 0xFFFFFFFF)
        bars: list[CandleBar] = []
        bar_count = 360
        # Walk backwards then forward so final close matches current_price cleanly
        walk_prices = [p]
        for _ in range(bar_count):
            step = rng.gauss(0, self.volatility * 1.15)
            p = max(settings.PRICE_FLOOR, round(p * (1.0 + step), 2))
            walk_prices.append(p)
        walk_prices.reverse()

        for idx in range(bar_count):
            ts = cur_bucket - (bar_count - idx) * CANDLE_INTERVAL_SEC
            o = walk_prices[idx]
            c = walk_prices[idx + 1] if idx < bar_count - 1 else self.current_price
            spread = max(0.20, abs(c - o) * 0.45 + o * self.volatility)
            h = round(max(o, c) + rng.uniform(0.05, spread), 2)
            l = max(settings.PRICE_FLOOR, round(min(o, c) - rng.uniform(0.05, spread), 2))
            vol = rng.randint(45, 320)
            bars.append(CandleBar(time=ts, open=o, high=h, low=l, close=c, volume=vol))

        self.candles.extend(bars)
        self._upsert_candle(cur_bucket, self.current_price, 0)

    def _upsert_candle(self, bucket_ts: int, price: float, volume_delta: int) -> dict:
        if self.candles and self.candles[-1].time == bucket_ts:
            bar = self.candles[-1]
            bar.high = max(bar.high, price)
            bar.low = min(bar.low, price)
            bar.close = price
            bar.volume += volume_delta
        else:
            prev_close = self.candles[-1].close if self.candles else price
            bar = CandleBar(
                time=bucket_ts,
                open=prev_close,
                high=max(prev_close, price),
                low=min(prev_close, price),
                close=price,
                volume=volume_delta,
            )
            self.candles.append(bar)
        return bar.to_dict()

    def record_trade_impact(self, side: str, qty: int, now_sec: float | None = None) -> float:
        """Apply AMM bonding curve price shift & update 30s crowd pressure meter."""
        ts = now_sec or time.time()
        signed_qty = qty if side in ("BUY", "COVER") else -qty
        flow_side = "BUY" if signed_qty > 0 else "SELL"

        self.flow_window.append((ts, flow_side, qty))
        self.total_volume += qty

        # Dampened impact curve: liquidity_depth * 4 ensures 200 buyers of 40 shares push ~+40-60%
        effective_depth = self.liquidity_depth * 4.0
        impact_factor = signed_qty / effective_depth
        # Bound per-order jump so whale orders stay realistic & bounded
        impact_factor = max(-0.45, min(0.45, impact_factor))

        self.prev_price = self.current_price
        new_price = max(settings.PRICE_FLOOR, round(self.current_price * (1.0 + impact_factor), 2))
        self.current_price = new_price
        self._upsert_candle(align_bucket(int(ts)), new_price, qty)
        return new_price

    def apply_era_shock(self, delta_pct: float, now_sec: float | None = None) -> float:
        """Atomic macro shock: moves both current price and anchor price instantaneously."""
        ts = now_sec or time.time()
        self.prev_price = self.current_price
        new_price = max(settings.PRICE_FLOOR, round(self.current_price * (1.0 + delta_pct), 2))
        self.current_price = new_price
        self.anchor_price = new_price
        self.era_open_price = self.prev_price
        # Add impulse synthetic volume proportional to shock magnitude for dramatic chart bars
        shock_vol = max(500, int(abs(delta_pct) * 4000))
        self.total_volume += shock_vol
        flow_side = "BUY" if delta_pct >= 0 else "SELL"
        self.flow_window.append((ts, flow_side, shock_vol))
        self._upsert_candle(align_bucket(int(ts)), new_price, shock_vol)
        return new_price

    def force_price(self, target_price: float, now_sec: float | None = None) -> float:
        ts = now_sec or time.time()
        self.prev_price = self.current_price
        clamped = max(settings.PRICE_FLOOR, round(target_price, 2))
        self.current_price = clamped
        self.anchor_price = clamped
        self._upsert_candle(align_bucket(int(ts)), clamped, 200)
        return clamped

    def apply_jitter_tick(self, now_sec: int) -> None:
        """Ornstein-Uhlenbeck mean-reverting organic tick (0 DB writes)."""
        deviation = (self.current_price - self.anchor_price) / max(self.anchor_price, 1.0)
        shock = self.volatility * random.gauss(0.0, 1.0) - 0.10 * deviation
        self.prev_price = self.current_price
        new_price = max(settings.PRICE_FLOOR, round(self.current_price * (1.0 + shock), 2))
        self.current_price = new_price
        self._upsert_candle(align_bucket(now_sec), new_price, random.randint(5, 45))

    def get_flow_metrics(self, now_sec: float | None = None) -> tuple[int, int, float]:
        ts = now_sec or time.time()
        cutoff = ts - 30.0
        while self.flow_window and self.flow_window[0][0] < cutoff:
            self.flow_window.popleft()

        buy_vol = sum(q for _, s, q in self.flow_window if s == "BUY")
        sell_vol = sum(q for _, s, q in self.flow_window if s == "SELL")
        total = buy_vol + sell_vol
        buy_pct = round((buy_vol / total) * 100.0, 1) if total > 0 else 50.0
        return buy_vol, sell_vol, buy_pct

    def to_tick_dict(self, now_sec: float | None = None) -> dict:
        buy_vol, sell_vol, buy_pct = self.get_flow_metrics(now_sec)
        change_pct = round(((self.current_price - self.base_price) / self.base_price) * 100.0, 2)
        tick_delta_pct = round(((self.current_price - self.prev_price) / self.prev_price) * 100.0, 2) if self.prev_price else 0.0
        latest_bar = self.candles[-1].to_dict() if self.candles else None
        return {
            "symbol": self.symbol,
            "price": self.current_price,
            "anchor_price": self.anchor_price,
            "base_price": self.base_price,
            "change_pct": change_pct,
            "tick_delta_pct": tick_delta_pct,
            "buy_vol_30s": buy_vol,
            "sell_vol_30s": sell_vol,
            "buy_pressure_pct": buy_pct,
            "total_volume": self.total_volume,
            "candle": latest_bar,
        }


class MarketEngine:
    def __init__(self):
        self.stocks: dict[str, StockRuntimeState] = {}
        self.is_market_open: bool = True
        self.is_leaderboard_frozen: bool = False
        self.ticks_enabled: bool = True
        self.active_era_id: str = "BASE"
        self.active_scenario_name: str = "Normal Trading — Round 0 Base"
        self.active_headline: str = "GENESIS 2026 Market Floor Open — ₹25,000 Virtual Capital Credited"
        self.seq: int = 0
        self.tick_history: deque = deque(maxlen=180)  # Last 3 mins of ticks for HTTP polling fallback
        self.last_orders_per_sec: float = 0.0
        self._order_timestamps: deque = deque()
        self.init_from_catalog()

    def init_from_catalog(self) -> None:
        now_sec = int(time.time())
        self.stocks.clear()
        for item in STOCKS_CATALOG:
            st = StockRuntimeState(
                symbol=item["symbol"],
                company_name=item["company_name"],
                sector=item["sector"],
                pe_ratio=item["pe_ratio"],
                base_price=item["base_price"],
                anchor_price=item["base_price"],
                current_price=item["base_price"],
                prev_price=item["base_price"],
                volatility=item["volatility"],
                liquidity_depth=item["liquidity_depth"],
                era_open_price=item["base_price"],
            )
            st.seed_history(now_sec)
            self.stocks[st.symbol] = st

    def record_order_throughput(self) -> None:
        now = time.time()
        self._order_timestamps.append(now)
        while self._order_timestamps and self._order_timestamps[0] < now - 5.0:
            self._order_timestamps.popleft()
        self.last_orders_per_sec = round(len(self._order_timestamps) / 5.0, 2)

    def step_jitter_if_enabled(self) -> None:
        now_sec = int(time.time())
        if self.is_market_open and self.ticks_enabled:
            for st in self.stocks.values():
                st.apply_jitter_tick(now_sec)
        else:
            # Keep active candle bucket advancing cleanly even if paused
            bucket = align_bucket(now_sec)
            for st in self.stocks.values():
                st._upsert_candle(bucket, st.current_price, 0)

    def build_tick_payload(self, event_name: str = "PRICE_TICK") -> dict:
        self.seq += 1
        now = time.time()
        payload = {
            "event": event_name,
            "seq": self.seq,
            "server_time_ms": int(now * 1000),
            "is_market_open": self.is_market_open,
            "ticks_enabled": self.ticks_enabled,
            "active_era_id": self.active_era_id,
            "active_scenario_name": self.active_scenario_name,
            "active_headline": self.active_headline,
            "stocks": [st.to_tick_dict(now) for st in self.stocks.values()],
        }
        self.tick_history.append(payload)
        return payload

    def get_bootstrap_catalog(self) -> list[dict]:
        now = time.time()
        result = []
        for st in self.stocks.values():
            entry = st.to_tick_dict(now)
            entry["company_name"] = st.company_name
            entry["sector"] = st.sector
            entry["pe_ratio"] = st.pe_ratio
            entry["candles"] = [c.to_dict() for c in st.candles]
            result.append(entry)
        return result

    def trigger_era(self, era_id: str) -> dict:
        if era_id not in SCENARIOS_MAP:
            raise ValueError(f"Unknown era_id: {era_id}")
        era = SCENARIOS_MAP[era_id]
        now = time.time()
        for sym, st in self.stocks.items():
            delta = era["deltas"].get(sym, 0.0)
            st.apply_era_shock(delta, now)
        self.active_era_id = era["id"]
        self.active_scenario_name = era["name"]
        self.active_headline = era["headline"]
        return era

    def inject_whale(self, symbol: str, side: str, qty: int) -> dict:
        if symbol not in self.stocks:
            raise ValueError(f"Unknown symbol: {symbol}")
        st = self.stocks[symbol]
        before = st.current_price
        after = st.record_trade_impact(side, qty)
        direction = "SURGE" if side in ("BUY", "COVER") else "DUMP"
        self.active_headline = (
            f"WHALE ALERT: Institutional desk executed {qty:,} share {direction} on {symbol} "
            f"(₹{before:.2f} -> ₹{after:.2f})!"
        )
        return {"symbol": symbol, "before": before, "after": after, "side": side, "qty": qty}

    def export_runtime_state(self) -> dict:
        return {
            "is_market_open": self.is_market_open,
            "is_leaderboard_frozen": self.is_leaderboard_frozen,
            "ticks_enabled": self.ticks_enabled,
            "active_era_id": self.active_era_id,
            "active_scenario_name": self.active_scenario_name,
            "active_headline": self.active_headline,
            "seq": self.seq,
            "stocks": {
                sym: {
                    "current_price": st.current_price,
                    "anchor_price": st.anchor_price,
                    "prev_price": st.prev_price,
                    "total_volume": st.total_volume,
                    "candles": [c.to_dict() for c in list(st.candles)[-60:]],
                }
                for sym, st in self.stocks.items()
            },
        }

    def restore_runtime_state(self, data: dict) -> None:
        self.is_market_open = data.get("is_market_open", True)
        self.is_leaderboard_frozen = data.get("is_leaderboard_frozen", False)
        self.ticks_enabled = data.get("ticks_enabled", True)
        self.active_era_id = data.get("active_era_id", "BASE")
        self.active_scenario_name = data.get("active_scenario_name", "Restored State")
        self.active_headline = data.get("active_headline", "Warm-Standby Failover Active")
        self.seq = data.get("seq", self.seq)
        stocks_data = data.get("stocks", {})
        for sym, sdata in stocks_data.items():
            if sym in self.stocks:
                st = self.stocks[sym]
                st.current_price = max(settings.PRICE_FLOOR, float(sdata["current_price"]))
                st.anchor_price = max(settings.PRICE_FLOOR, float(sdata["anchor_price"]))
                st.prev_price = max(settings.PRICE_FLOOR, float(sdata.get("prev_price", st.current_price)))
                st.total_volume = int(sdata.get("total_volume", 0))
                if sdata.get("candles"):
                    st.candles.clear()
                    for c in sdata["candles"]:
                        st.candles.append(CandleBar(**c))


market_engine = MarketEngine()

