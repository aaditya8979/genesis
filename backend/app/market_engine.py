"""In-Memory Authoritative Market State, OHLC Candle Aggregator, AMM Pricing & Momentum Engine."""

from collections import deque
from dataclasses import dataclass, field
import math
import random
import time

from app.config import get_settings
from app.scenarios_config import SCENARIOS_MAP, STOCKS_CATALOG

settings = get_settings()

CANDLE_INTERVAL_SEC = 5  # Base 5-second bars; UI resamples cleanly to 5s / 15s / 1m


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
    # Momentum regime drift (-1.0 bearish to +1.0 bullish) for realistic multi-candle trends
    momentum_bias: float = 0.0
    momentum_ticks_left: int = 0
    # Stochastic GARCH-like volatility clustering multiplier
    vol_cluster: float = 1.0
    cluster_ticks_left: int = 0
    # Rolling 30-second order flow events: (timestamp_float, side 'BUY'|'SELL', qty)
    flow_window: deque = field(default_factory=deque)
    # Historical 5-second OHLC candles (ring buffer of 480 bars = 40 mins of high-res history)
    candles: deque = field(default_factory=lambda: deque(maxlen=480))

    def seed_history(self, now_sec: int) -> None:
        """Seed 360 realistic 5s bars (30 mins) with organic trends, pullbacks & vol clusters."""
        if self.candles:
            return
        cur_bucket = align_bucket(now_sec)
        p = self.base_price
        rng = random.Random(hash(self.symbol) & 0xFFFFFFFF)
        bars: list[CandleBar] = []
        bar_count = 360
        walk_prices = [p]
        trend = rng.uniform(-0.0045, 0.0045)
        cluster = 1.0
        for i in range(bar_count):
            if i % rng.randint(8, 18) == 0:
                trend = rng.uniform(-0.0075, 0.0075)
                cluster = rng.choice([0.7, 1.0, 1.4, 2.1])
            step = trend + rng.gauss(0, max(self.volatility, 0.0022) * 2.1 * cluster)
            p = max(settings.PRICE_FLOOR, round(p * (1.0 + step), 2))
            walk_prices.append(p)
        walk_prices.reverse()

        for idx in range(bar_count):
            ts = cur_bucket - (bar_count - idx) * CANDLE_INTERVAL_SEC
            o = walk_prices[idx]
            c = walk_prices[idx + 1] if idx < bar_count - 1 else self.current_price
            spread = max(0.35, abs(c - o) * 0.65 + o * max(self.volatility, 0.0022) * 1.8)
            h = round(max(o, c) + rng.uniform(0.10, spread), 2)
            l = max(settings.PRICE_FLOOR, round(min(o, c) - rng.uniform(0.10, spread), 2))
            vol = rng.randint(180, 950)
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

    def _max_sane_price(self) -> float:
        return round(max(self.base_price * 15.0, 25000.0), 2)

    def _clamp_price(self, val: float) -> float:
        return max(settings.PRICE_FLOOR, min(self._max_sane_price(), round(val, 2)))

    def record_trade_impact(
        self,
        side: str,
        qty: int,
        now_sec: float | None = None,
        shift_anchor: bool = False,
        update_anchor: bool = True,
    ) -> float:
        """Apply AMM bonding curve price shift & update 30s crowd pressure meter."""
        ts = now_sec or time.time()
        signed_qty = qty if side in ("BUY", "COVER") else -qty
        flow_side = "BUY" if signed_qty > 0 else "SELL"

        self.flow_window.append((ts, flow_side, qty))
        self.total_volume += qty

        effective_depth = self.liquidity_depth * 3.5
        impact_factor = max(-0.25, min(0.25, signed_qty / effective_depth))

        self.prev_price = self.current_price
        new_price = self._clamp_price(self.current_price * (1.0 + impact_factor))
        self.current_price = new_price

        # Shift anchor only on real human/whale flow, never on synthetic noise sweeps
        if update_anchor:
            if shift_anchor:
                self.anchor_price = self._clamp_price(self.anchor_price * 0.25 + new_price * 0.75)
            else:
                self.anchor_price = self._clamp_price(self.anchor_price * 0.96 + new_price * 0.04)

        self._upsert_candle(align_bucket(int(ts)), new_price, qty)
        return new_price

    def apply_era_shock(self, delta_pct: float, now_sec: float | None = None) -> float:
        ts = now_sec or time.time()
        self.prev_price = self.current_price
        new_price = self._clamp_price(self.current_price * (1.0 + delta_pct))
        self.current_price = new_price
        self.anchor_price = new_price
        self.era_open_price = self.prev_price
        # Assign post-shock volatility momentum (panic continuation or bounce)
        self.momentum_bias = 0.45 if delta_pct > 0 else -0.45
        self.momentum_ticks_left = 8

        shock_vol = max(800, int(abs(delta_pct) * 5000))
        self.total_volume += shock_vol
        flow_side = "BUY" if delta_pct >= 0 else "SELL"
        self.flow_window.append((ts, flow_side, shock_vol))
        self._upsert_candle(align_bucket(int(ts)), new_price, shock_vol)
        return new_price

    def force_price(self, target_price: float, now_sec: float | None = None) -> float:
        ts = now_sec or time.time()
        self.prev_price = self.current_price
        clamped = self._clamp_price(target_price)
        self.current_price = clamped
        self.anchor_price = clamped
        self._upsert_candle(align_bucket(int(ts)), clamped, 350)
        return clamped

    def apply_dynamic_tick(
        self,
        now_sec: int,
        vol_multiplier: float = 1.0,
        simulate_flow: bool = True,
        sector_drift: float = 0.0,
    ) -> None:
        """Bounded, non-drifting Log-OU multi-regime simulation (lively candles without runaway)."""
        if self.momentum_ticks_left <= 0:
            # Sustained unpredictable multi-candle waves (10 to 30s) with mean-reverting bias
            if random.random() < 0.28:
                self.momentum_bias = -self.momentum_bias * random.uniform(0.7, 1.15) or random.choice([-0.8, 0.8])
            else:
                self.momentum_bias = random.choice([-1.0, -0.65, -0.3, 0.3, 0.65, 1.0]) * random.uniform(0.5, 1.0)
            self.momentum_ticks_left = random.randint(10, 30)
        else:
            self.momentum_ticks_left -= 1

        if self.cluster_ticks_left <= 0:
            self.vol_cluster = random.choices([0.75, 1.1, 1.55, 2.1], weights=[22, 46, 22, 10])[0]
            self.cluster_ticks_left = random.randint(8, 22)
        else:
            self.cluster_ticks_left -= 1

        # Log-space Ornstein-Uhlenbeck mean reversion around anchor_price (zero upward compounding!)
        anchor = max(settings.PRICE_FLOOR, min(self._max_sane_price(), self.anchor_price))
        self.anchor_price = anchor
        log_dev = math.log(max(self.current_price, settings.PRICE_FLOOR) / anchor)

        # Gentle room for ±18% waves, firmer elastic pullback beyond ±20% so prices stay realistic forever
        if abs(log_dev) > 0.22:
            mean_pull = -0.045 * log_dev
        elif abs(log_dev) > 0.12:
            mean_pull = -0.015 * log_dev
        else:
            mean_pull = -0.004 * log_dev

        # Counter-trend bias if momentum is pushing even further past ±22% from anchor
        if (log_dev > 0.22 and self.momentum_bias > 0) or (log_dev < -0.22 and self.momentum_bias < 0):
            self.momentum_bias *= -0.7

        floor_recovery = 0.0012 if (self.current_price < 15.0 and log_dev < 0.0) else 0.0
        eff_vol = max(self.volatility, 0.0022) * vol_multiplier * self.vol_cluster
        low_price_boost = 1.35 if self.current_price < 35.0 else 1.0

        # Subtract Ito half-variance correction (-0.5 * sigma^2) so E[log(P)] has zero upward drift
        sigma = eff_vol * 1.65 * low_price_boost
        ito_fix = -0.5 * (sigma ** 2)
        drift = (self.momentum_bias * eff_vol * 0.75) + sector_drift + floor_recovery + ito_fix
        noise = sigma * random.gauss(0.0, 1.0)
        pct_move = max(-0.035, min(0.035, drift + noise + mean_pull))

        # Hard peacetime band around anchor [0.55x, 1.75x] so a forgotten server stays sane for days
        upper_band = min(self._max_sane_price(), round(anchor * 1.75, 2))
        lower_band = max(settings.PRICE_FLOOR, round(anchor * 0.52, 2))
        self.prev_price = self.current_price
        raw_next = round(self.current_price * (1.0 + pct_move), 2)
        new_price = max(lower_band, min(upper_band, max(settings.PRICE_FLOOR, raw_next)))
        self.current_price = new_price

        # Balanced bot/institutional sweeps (never shift_anchor on synthetic noise!)
        sim_vol = 0
        if simulate_flow:
            if random.random() < 0.045:
                buy_prob = 0.32 if log_dev > 0.08 else 0.68 if log_dev < -0.08 else 0.50
                sweep_side = "BUY" if random.random() < buy_prob else "SELL"
                sweep_qty = random.randint(180, 560)
                self.record_trade_impact(
                    sweep_side, sweep_qty, float(now_sec), shift_anchor=False, update_anchor=False
                )
                self.current_price = max(lower_band, min(upper_band, self.current_price))
                return

            sim_vol = random.randint(45, 290)
            flow_side = "BUY" if (pct_move > 0 or (pct_move == 0 and random.random() < 0.5)) else "SELL"
            self.flow_window.append((float(now_sec), flow_side, sim_vol))
            self.total_volume += sim_vol

        self._upsert_candle(align_bucket(now_sec), new_price, sim_vol)

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
        self.volatility_regime: str = "DYNAMIC"  # CALM (0.5x) | DYNAMIC (1.4x) | FRENZY (2.6x)
        self.simulate_flow_enabled: bool = True
        self.active_era_id: str = "BASE"
        self.active_scenario_name: str = "Normal Trading — Round 0 Base"
        self.active_headline: str = "GENESIS 2026 Market Floor Open — ₹25,000 Virtual Capital Credited"
        self.event_feed: deque = deque(maxlen=15)
        self.chart_markers: deque = deque(maxlen=30)
        self.seq: int = 0
        self.tick_history: deque = deque(maxlen=180)
        self.last_orders_per_sec: float = 0.0
        self._order_timestamps: deque = deque()
        self.sector_waves: dict[str, float] = {}
        self._next_sector_rotation_ts: float = 0.0
        self.init_from_catalog()

    def init_from_catalog(self) -> None:
        now_sec = int(time.time())
        self.stocks.clear()
        self.event_feed.clear()
        self.chart_markers.clear()
        self.event_feed.append({
            "id": f"init-{now_sec}",
            "time_ms": now_sec * 1000,
            "type": "INFO",
            "title": "Round 0 Base Open",
            "headline": self.active_headline,
        })
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

    def set_volatility_regime(self, regime: str, simulate_flow: bool = True) -> None:
        regime = regime.upper()
        if regime not in ("CALM", "DYNAMIC", "FRENZY"):
            raise ValueError("Regime must be CALM, DYNAMIC, or FRENZY")
        self.volatility_regime = regime
        self.simulate_flow_enabled = simulate_flow

    def _get_vol_multiplier(self) -> float:
        if self.volatility_regime == "CALM":
            return 0.75
        if self.volatility_regime == "FRENZY":
            return 3.0
        return 1.75  # DYNAMIC default: crisp multi-wave intraday action

    def record_order_throughput(self) -> None:
        now = time.time()
        self._order_timestamps.append(now)
        while self._order_timestamps and self._order_timestamps[0] < now - 5.0:
            self._order_timestamps.popleft()
        self.last_orders_per_sec = round(len(self._order_timestamps) / 5.0, 2)

    def _refresh_sector_rotations(self, now_sec: float) -> None:
        if now_sec < self._next_sector_rotation_ts and self.sector_waves:
            return
        self._next_sector_rotation_ts = now_sec + random.uniform(18.0, 48.0)
        for st in self.stocks.values():
            if st.sector not in self.sector_waves or random.random() < 0.65:
                self.sector_waves[st.sector] = random.choice([-0.0020, -0.0010, 0.0, 0.0010, 0.0020])

    def step_jitter_if_enabled(self) -> None:
        now_sec = int(time.time())
        if self.is_market_open and self.ticks_enabled:
            self._refresh_sector_rotations(float(now_sec))
            mult = self._get_vol_multiplier()
            for st in self.stocks.values():
                sec_drift = self.sector_waves.get(st.sector, 0.0)
                st.apply_dynamic_tick(
                    now_sec,
                    vol_multiplier=mult,
                    simulate_flow=self.simulate_flow_enabled,
                    sector_drift=sec_drift,
                )
        else:
            bucket = align_bucket(now_sec)
            for st in self.stocks.values():
                st._upsert_candle(bucket, st.current_price, 0)

    def reset_market_to_base(self) -> None:
        """Restore all 30 equities smoothly back to Round 0 base prices with lively fresh candles."""
        self.active_era_id = "BASE"
        self.active_scenario_name = "Normal Trading — Round 0 Base"
        self.active_headline = "GENESIS 2026 Market Reset — Fresh Round Open Across All 30 Equities"
        self.volatility_regime = "DYNAMIC"
        self.init_from_catalog()

    def _add_marker(self, ts_sec: int, label: str, color: str, symbol: str = "ALL") -> None:
        bucket = align_bucket(ts_sec)
        # Prevent overlapping markers on the exact same candle bucket
        for m in self.chart_markers:
            if m["time"] == bucket and m["symbol"] == symbol:
                m["label"] = f"{m['label']} + {label}"
                return
        self.chart_markers.append({
            "time": bucket,
            "label": label,
            "color": color,
            "symbol": symbol,
        })

    def build_tick_payload(self, event_name: str = "PRICE_TICK") -> dict:
        self.seq += 1
        now = time.time()
        payload = {
            "event": event_name,
            "seq": self.seq,
            "server_time_ms": int(now * 1000),
            "is_market_open": self.is_market_open,
            "ticks_enabled": self.ticks_enabled,
            "volatility_regime": self.volatility_regime,
            "active_era_id": self.active_era_id,
            "active_scenario_name": self.active_scenario_name,
            "active_headline": self.active_headline,
            "stocks": [st.to_tick_dict(now) for st in self.stocks.values()],
        }
        # Omit static news & markers from 1Hz PRICE_TICK to save ~40% EC2 egress bandwidth across 1,000 sockets
        if event_name != "PRICE_TICK":
            payload["event_feed"] = list(self.event_feed)
            payload["chart_markers"] = list(self.chart_markers)
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

        color = "#EB5B3C" if era["severity"] == "CRASH" else "#00D09C" if era["severity"] == "BOOM" else "#F59E0B"
        self._add_marker(int(now), f"E{era['order']}", color, "ALL")
        self.event_feed.appendleft({
            "id": f"era-{era['id']}-{int(now*1000)}",
            "time_ms": int(now * 1000),
            "type": era["severity"],
            "title": era["name"],
            "headline": era["headline"],
        })
        return era

    def inject_whale(self, symbol: str, side: str, qty: int) -> dict:
        if symbol not in self.stocks:
            raise ValueError(f"Unknown symbol: {symbol}")
        now = time.time()
        st = self.stocks[symbol]
        before = st.current_price
        after = st.record_trade_impact(side, qty, now, shift_anchor=True)
        direction = "SURGE" if side in ("BUY", "COVER") else "DUMP"
        headline = (
            f"WHALE {direction}: Institutional desk moved {qty:,} {symbol} "
            f"(₹{before:.2f} -> ₹{after:.2f})"
        )
        self.active_headline = headline
        color = "#00D09C" if direction == "SURGE" else "#EB5B3C"
        self._add_marker(int(now), f"W:{symbol}", color, symbol)
        self.event_feed.appendleft({
            "id": f"whale-{symbol}-{int(now*1000)}",
            "time_ms": int(now * 1000),
            "type": "WHALE",
            "title": f"{symbol} Whale {direction}",
            "headline": headline,
        })
        return {"symbol": symbol, "before": before, "after": after, "side": side, "qty": qty}

    def add_broadcast_event(self, headline: str) -> None:
        now = time.time()
        self.active_headline = headline
        self.event_feed.appendleft({
            "id": f"alert-{int(now*1000)}",
            "time_ms": int(now * 1000),
            "type": "ALERT",
            "title": "Floor Broadcast",
            "headline": headline,
        })

    def export_runtime_state(self) -> dict:
        return {
            "is_market_open": self.is_market_open,
            "is_leaderboard_frozen": self.is_leaderboard_frozen,
            "ticks_enabled": self.ticks_enabled,
            "volatility_regime": self.volatility_regime,
            "simulate_flow_enabled": self.simulate_flow_enabled,
            "active_era_id": self.active_era_id,
            "active_scenario_name": self.active_scenario_name,
            "active_headline": self.active_headline,
            "event_feed": list(self.event_feed),
            "chart_markers": list(self.chart_markers),
            "seq": self.seq,
            "stocks": {
                sym: {
                    "current_price": st.current_price,
                    "anchor_price": st.anchor_price,
                    "prev_price": st.prev_price,
                    "total_volume": st.total_volume,
                    "candles": [c.to_dict() for c in list(st.candles)[-120:]],
                }
                for sym, st in self.stocks.items()
            },
        }

    def restore_runtime_state(self, data: dict) -> None:
        self.is_market_open = data.get("is_market_open", True)
        self.is_leaderboard_frozen = data.get("is_leaderboard_frozen", False)
        self.ticks_enabled = data.get("ticks_enabled", True)
        self.volatility_regime = data.get("volatility_regime", "DYNAMIC")
        self.simulate_flow_enabled = data.get("simulate_flow_enabled", True)
        self.active_era_id = data.get("active_era_id", "BASE")
        self.active_scenario_name = data.get("active_scenario_name", "Restored State")
        self.active_headline = data.get("active_headline", "Warm-Standby Failover Active")
        if data.get("event_feed"):
            self.event_feed = deque(data["event_feed"], maxlen=15)
        if data.get("chart_markers"):
            self.chart_markers = deque(data["chart_markers"], maxlen=30)
        self.seq = data.get("seq", self.seq)
        stocks_data = data.get("stocks", {})
        for sym, sdata in stocks_data.items():
            if sym in self.stocks:
                st = self.stocks[sym]
                # Guard against corrupted runaway snapshots from earlier builds
                if float(sdata["current_price"]) > st._max_sane_price():
                    continue
                st.current_price = st._clamp_price(float(sdata["current_price"]))
                st.anchor_price = st._clamp_price(float(sdata["anchor_price"]))
                st.prev_price = st._clamp_price(float(sdata.get("prev_price", st.current_price)))
                st.total_volume = int(sdata.get("total_volume", 0))
                if sdata.get("candles"):
                    valid_bars = [c for c in sdata["candles"] if float(c.get("high", 0)) <= st._max_sane_price()]
                    if valid_bars:
                        st.candles.clear()
                        for c in valid_bars:
                            st.candles.append(CandleBar(**c))


market_engine = MarketEngine()
