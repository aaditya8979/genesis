import { create } from "zustand";
import { loadCandleRingCache, saveCandleRingCache } from "../lib/gateway";
import {
  CandleBar,
  ChartMarkerItem,
  ConnectionMode,
  EventFeedItem,
  Portfolio,
  PriceScaleModeType,
  StockTick,
  StudentUser,
  TimeframeSec,
  TransactionItem,
} from "../lib/types";

export type PreferredOrderSide = "BUY" | "SELL" | "SHORT" | "COVER";

interface MarketStoreState {
  user: StudentUser | null;
  portfolio: Portfolio | null;
  transactions: TransactionItem[];
  stocksOrder: string[];
  stocks: Record<string, StockTick>;
  candles: Record<string, CandleBar[]>;
  selectedSymbol: string;
  timeframeSec: TimeframeSec;
  seq: number;
  isMarketOpen: boolean;
  ticksEnabled: boolean;
  volatilityRegime: string;
  activeEraId: string;
  activeScenarioName: string;
  activeHeadline: string;
  eventFeed: EventFeedItem[];
  chartMarkers: ChartMarkerItem[];
  connectionMode: ConnectionMode;
  activeGatewayLabel: string;

  // Interactive Chart & TradingView Controls
  preferredOrderTab: PreferredOrderSide;
  magnetCrosshair: boolean;
  showEntryLine: boolean;
  showEraMarkers: boolean;
  autoScale: boolean;
  priceScaleMode: PriceScaleModeType;
  chartCommandNonce: number;
  chartCommand: "FIT" | "ZOOM_IN" | "ZOOM_OUT" | "RANGE_10M" | "RANGE_30M" | "RANGE_ALL" | null;

  setSelectedSymbol: (symbol: string) => void;
  setTimeframeSec: (tf: TimeframeSec) => void;
  setPreferredOrderTab: (tab: PreferredOrderSide) => void;
  toggleMagnetCrosshair: () => void;
  toggleEntryLine: () => void;
  toggleEraMarkers: () => void;
  setAutoScale: (val: boolean) => void;
  setPriceScaleMode: (mode: PriceScaleModeType) => void;
  dispatchChartCommand: (
    cmd: "FIT" | "ZOOM_IN" | "ZOOM_OUT" | "RANGE_10M" | "RANGE_30M" | "RANGE_ALL"
  ) => void;

  setConnectionMode: (mode: ConnectionMode, label?: string) => void;
  hydrateBootstrap: (payload: any) => void;
  applyTickPayload: (payload: any) => void;
  applyPortfolioUpdate: (portfolio: Portfolio, tx?: TransactionItem) => void;
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
  timeframeSec: 15,
  seq: 0,
  isMarketOpen: true,
  ticksEnabled: true,
  volatilityRegime: "DYNAMIC",
  activeEraId: "BASE",
  activeScenarioName: "Normal Trading — Round 0 Base",
  activeHeadline: "GENESIS 2026 Floor Open — ₹25,000 Virtual Capital Credited",
  eventFeed: [],
  chartMarkers: [],
  connectionMode: "CONNECTING",
  activeGatewayLabel: "PRIMARY",

  preferredOrderTab: "BUY",
  magnetCrosshair: false,
  showEntryLine: true,
  showEraMarkers: true,
  autoScale: true,
  priceScaleMode: "NORMAL",
  chartCommandNonce: 0,
  chartCommand: null,

  setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
  setTimeframeSec: (tf) => set({ timeframeSec: tf }),
  setPreferredOrderTab: (tab) => set({ preferredOrderTab: tab }),
  toggleMagnetCrosshair: () => set((s) => ({ magnetCrosshair: !s.magnetCrosshair })),
  toggleEntryLine: () => set((s) => ({ showEntryLine: !s.showEntryLine })),
  toggleEraMarkers: () => set((s) => ({ showEraMarkers: !s.showEraMarkers })),
  setAutoScale: (val) => set({ autoScale: val }),
  setPriceScaleMode: (mode) => set({ priceScaleMode: mode }),
  dispatchChartCommand: (cmd) =>
    set((s) => ({ chartCommand: cmd, chartCommandNonce: s.chartCommandNonce + 1 })),

  setConnectionMode: (mode, label) =>
    set((s) => ({
      connectionMode: mode,
      activeGatewayLabel: label ?? s.activeGatewayLabel,
    })),

  hydrateBootstrap: (payload) => {
    const stocksMap: Record<string, StockTick> = {};
    const candlesMap: Record<string, CandleBar[]> = { ...get().candles };
    const order: string[] = [];

    for (const s of payload.stocks || []) {
      order.push(s.symbol);
      stocksMap[s.symbol] = s;
      if (s.candles && s.candles.length > 0) {
        candlesMap[s.symbol] = s.candles;
      }
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
      volatilityRegime: payload.volatility_regime ?? "DYNAMIC",
      activeEraId: payload.active_era_id ?? "BASE",
      activeScenarioName: payload.active_scenario_name ?? state.activeScenarioName,
      activeHeadline: payload.active_headline ?? state.activeHeadline,
      eventFeed: payload.event_feed ?? state.eventFeed,
      chartMarkers: payload.chart_markers ?? state.chartMarkers,
      selectedSymbol: stocksMap[state.selectedSymbol] ? state.selectedSymbol : order[0] || "TMND",
    }));
  },

  applyTickPayload: (payload) => {
    const state = get();
    if (!payload || !payload.stocks) return;

    const nextStocks = { ...state.stocks };
    const nextCandles = { ...state.candles };

    for (const tick of payload.stocks as StockTick[]) {
      const prev = nextStocks[tick.symbol];
      nextStocks[tick.symbol] = prev ? { ...prev, ...tick } : tick;

      if (tick.candle) {
        const existing = nextCandles[tick.symbol] ? [...nextCandles[tick.symbol]] : [];
        const bar = { ...tick.candle };
        if (existing.length > 0 && existing[existing.length - 1].time === bar.time) {
          existing[existing.length - 1] = bar;
        } else if (existing.length === 0 || bar.time > existing[existing.length - 1].time) {
          existing.push(bar);
          if (existing.length > 480) existing.shift();
        }
        nextCandles[tick.symbol] = existing;
      }
    }

    let nextPortfolio = state.portfolio;
    if (nextPortfolio) {
      let longVal = 0;
      let shortLiab = 0;
      let shortUnrealized = 0;
      let totalUpnl = 0;
      const updatedHoldings = nextPortfolio.holdings.map((h) => {
        const livePrice = nextStocks[h.symbol]?.price ?? h.current_price;
        const mktVal = Number((livePrice * h.quantity).toFixed(2));
        const costBasis = h.avg_entry_price * h.quantity;
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
        (nextPortfolio.cash_balance + nextPortfolio.collateral_locked + longVal + shortUnrealized).toFixed(2)
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

    if ((payload.seq ?? 0) % 5 === 0) {
      saveCandleRingCache(nextCandles);
    }

    set({
      stocks: nextStocks,
      candles: nextCandles,
      portfolio: nextPortfolio,
      seq: payload.seq ?? state.seq,
      isMarketOpen: payload.is_market_open ?? state.isMarketOpen,
      ticksEnabled: payload.ticks_enabled ?? state.ticksEnabled,
      volatilityRegime: payload.volatility_regime ?? state.volatilityRegime,
      activeEraId: payload.active_era_id ?? state.activeEraId,
      activeScenarioName: payload.active_scenario_name ?? state.activeScenarioName,
      activeHeadline: payload.active_headline ?? state.activeHeadline,
      eventFeed: payload.event_feed ?? state.eventFeed,
      chartMarkers: payload.chart_markers ?? state.chartMarkers,
    });
  },

  applyPortfolioUpdate: (portfolio, tx) =>
    set((s) => ({
      portfolio,
      transactions: tx ? [tx, ...s.transactions].slice(0, 50) : s.transactions,
    })),

  setFrozenStatus: (isFrozen) =>
    set((s) => (s.user ? { user: { ...s.user, is_frozen: isFrozen } } : {})),

  resetSession: () => {
    localStorage.removeItem("genesis_token");
    set({ user: null, portfolio: null, transactions: [], connectionMode: "CONNECTING" });
  },
}));
