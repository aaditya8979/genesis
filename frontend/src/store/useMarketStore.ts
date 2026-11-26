import { create } from "zustand";
import { loadCandleRingCache, saveCandleRingCache } from "../lib/gateway";
import { CandleBar, ConnectionMode, Portfolio, StockTick, StudentUser, TransactionItem } from "../lib/types";

interface MarketStoreState {
  user: StudentUser | null;
  portfolio: Portfolio | null;
  transactions: TransactionItem[];
  stocksOrder: string[];
  stocks: Record<string, StockTick>;
  candles: Record<string, CandleBar[]>;
  selectedSymbol: string;
  timeframeSec: 5 | 15 | 60;
  seq: number;
  isMarketOpen: boolean;
  ticksEnabled: boolean;
  activeEraId: string;
  activeScenarioName: string;
  activeHeadline: string;
  connectionMode: ConnectionMode;
  activeGatewayLabel: string;
  eraMarkers: Array<{ time: number; label: string; color: string }>;

  setSelectedSymbol: (symbol: string) => void;
  setTimeframeSec: (tf: 5 | 15 | 60) => void;
  setConnectionMode: (mode: ConnectionMode, label?: string) => void;
  hydrateBootstrap: (payload: any) => void;
  applyTickPayload: (payload: any) => void;
  applyPortfolioUpdate: (portfolio: Portfolio, newTx?: TransactionItem) => void;
  setFrozenStatus: (isFrozen: boolean) => void;
  resetSession: () => void;
}

const cachedCandles = loadCandleRingCache();

export const useMarketStore = create<MarketStoreState>((set, get) => ({
  user: null,
  portfolio: null,
  transactions: [],
  stocksOrder: [],
  stocks: {},
  candles: cachedCandles,
  selectedSymbol: "TMND",
  timeframeSec: 5,
  seq: 0,
  isMarketOpen: true,
  ticksEnabled: true,
  activeEraId: "BASE",
  activeScenarioName: "Normal Trading — Round 0 Base",
  activeHeadline: "GENESIS 2026 Floor Open — ₹25,000 Virtual Capital Credited",
  connectionMode: "CONNECTING",
  activeGatewayLabel: "PRIMARY",
  eraMarkers: [],

  setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
  setTimeframeSec: (tf) => set({ timeframeSec: tf }),
  setConnectionMode: (mode, label) =>
    set((s) => ({
      connectionMode: mode,
      activeGatewayLabel: label ?? s.activeGatewayLabel,
    })),

  hydrateBootstrap: (payload) => {
    const stocksMap: Record<string, StockTick> = {};
    const candlesMap: Record<string, CandleBar[]> = {};
    const order: string[] = [];

    for (const item of payload.stocks || []) {
      order.push(item.symbol);
      const { candles, ...rest } = item;
      stocksMap[item.symbol] = rest;
      candlesMap[item.symbol] = candles || [];
    }
    saveCandleRingCache(candlesMap);

    set((state) => ({
      user: payload.user,
      portfolio: payload.portfolio,
      transactions: payload.transactions || [],
      stocksOrder: order,
      stocks: stocksMap,
      candles: candlesMap,
      seq: payload.seq ?? state.seq,
      isMarketOpen: payload.is_market_open ?? true,
      ticksEnabled: payload.ticks_enabled ?? true,
      activeEraId: payload.active_era_id ?? "BASE",
      activeScenarioName: payload.active_scenario_name ?? state.activeScenarioName,
      activeHeadline: payload.active_headline ?? state.activeHeadline,
      selectedSymbol: stocksMap[state.selectedSymbol] ? state.selectedSymbol : order[0] || "TMND",
    }));
  },

  applyTickPayload: (payload) => {
    const state = get();
    if (!payload?.stocks) return;

    const nextStocks = { ...state.stocks };
    const nextCandles = { ...state.candles };
    const isEraShock = payload.event === "ERA_SHOCK";
    let shockTime: number | null = null;

    for (const tick of payload.stocks as StockTick[]) {
      const prev = nextStocks[tick.symbol];
      nextStocks[tick.symbol] = prev ? { ...prev, ...tick } : tick;

      if (tick.candle) {
        const existing = nextCandles[tick.symbol] ? [...nextCandles[tick.symbol]] : [];
        const bar = tick.candle;
        if (shockTime === null) shockTime = bar.time;
        if (existing.length > 0 && existing[existing.length - 1].time === bar.time) {
          existing[existing.length - 1] = bar;
        } else if (existing.length === 0 || bar.time > existing[existing.length - 1].time) {
          existing.push(bar);
          if (existing.length > 360) existing.shift();
        }
        nextCandles[tick.symbol] = existing;
      }
    }

    // Recompute live unrealized P&L & net worth on client every tick with zero extra API calls
    let nextPortfolio = state.portfolio;
    if (nextPortfolio) {
      let longVal = 0;
      let shortLiab = 0;
      let shortUnrealized = 0;
      let totalUpnl = 0;
      const updatedHoldings = nextPortfolio.holdings.map((h) => {
        const livePrice = nextStocks[h.symbol]?.price ?? h.current_price;
        const mktVal = Number((h.quantity * livePrice).toFixed(2));
        const costBasis = h.quantity * h.avg_entry_price;
        const upnl =
          h.position_type === "LONG"
            ? Number((mktVal - costBasis).toFixed(2))
            : Number((costBasis - mktVal).toFixed(2));
        if (h.position_type === "LONG") longVal += mktVal;
        else {
          shortLiab += mktVal;
          shortUnrealized += upnl;
        }
        totalUpnl += upnl;
        return {
          ...h,
          current_price: livePrice,
          market_value: mktVal,
          unrealized_pnl: upnl,
          pnl_pct: costBasis > 0 ? Number(((upnl / costBasis) * 100).toFixed(2)) : 0,
        };
      });
      const netWorth = Number(
        (nextPortfolio.cash_balance + longVal + nextPortfolio.collateral_locked + shortUnrealized).toFixed(2)
      );
      nextPortfolio = {
        ...nextPortfolio,
        long_value: Number(longVal.toFixed(2)),
        short_liability: Number(shortLiab.toFixed(2)),
        unrealized_pnl: Number(totalUpnl.toFixed(2)),
        net_worth: netWorth,
        holdings: updatedHoldings,
      };
    }

    if ((payload.seq ?? 0) % 10 === 0) {
      saveCandleRingCache(nextCandles);
    }

    const nextMarkers =
      isEraShock && shockTime
        ? [
            ...state.eraMarkers,
            {
              time: shockTime,
              label: payload.active_era_id || "ERA",
              color: "#F59E0B",
            },
          ]
        : state.eraMarkers;

    set({
      stocks: nextStocks,
      candles: nextCandles,
      portfolio: nextPortfolio,
      seq: payload.seq ?? state.seq,
      isMarketOpen: payload.is_market_open ?? state.isMarketOpen,
      ticksEnabled: payload.ticks_enabled ?? state.ticksEnabled,
      activeEraId: payload.active_era_id ?? state.activeEraId,
      activeScenarioName: payload.active_scenario_name ?? state.activeScenarioName,
      activeHeadline: payload.active_headline ?? state.activeHeadline,
      eraMarkers: nextMarkers,
    });
  },

  applyPortfolioUpdate: (portfolio, newTx) =>
    set((s) => ({
      portfolio,
      transactions: newTx ? [newTx, ...s.transactions].slice(0, 40) : s.transactions,
    })),

  setFrozenStatus: (isFrozen) =>
    set((s) => ({
      user: s.user ? { ...s.user, is_frozen: isFrozen } : null,
    })),

  resetSession: () => {
    localStorage.removeItem("genesis_token");
    set({
      user: null,
      portfolio: null,
      transactions: [],
    });
  },
}));
