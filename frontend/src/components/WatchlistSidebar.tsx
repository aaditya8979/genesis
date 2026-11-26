import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { getSymbolBadgeColor } from "../lib/theme";
import { useMarketStore } from "../store/useMarketStore";

type SortMode = "DEFAULT" | "GAINERS" | "LOSERS" | "VOLUME";

export function WatchlistSidebar() {
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("DEFAULT");

  const stocksOrder = useMarketStore((s) => s.stocksOrder);
  const stocks = useMarketStore((s) => s.stocks);
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const setSelectedSymbol = useMarketStore((s) => s.setSelectedSymbol);

  const filteredList = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = stocksOrder
      .map((sym) => stocks[sym])
      .filter((st) => {
        if (!st) return false;
        if (!q) return true;
        return (
          st.symbol.toLowerCase().includes(q) ||
          (st.company_name || "").toLowerCase().includes(q) ||
          (st.sector || "").toLowerCase().includes(q)
        );
      });

    if (sortMode === "GAINERS") return [...list].sort((a, b) => b.change_pct - a.change_pct);
    if (sortMode === "LOSERS") return [...list].sort((a, b) => a.change_pct - b.change_pct);
    if (sortMode === "VOLUME") return [...list].sort((a, b) => b.total_volume - a.total_volume);
    return list;
  }, [stocksOrder, stocks, query, sortMode]);

  return (
    <section className="bg-[var(--tv-bg)] flex flex-col min-w-0 min-h-0 h-full overflow-hidden">
      {/* Header + Compact Search & Sort */}
      <div className="px-3 py-2 border-b border-[var(--tv-border)] space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[var(--tv-text)]">Watchlist</span>
          <div className="flex items-center gap-0.5 text-[10px] font-semibold">
            {(["DEFAULT", "GAINERS", "LOSERS", "VOLUME"] as SortMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSortMode(mode)}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  sortMode === mode
                    ? "bg-[#2962FF]/15 text-[#2962FF]"
                    : "text-[var(--tv-muted)] hover:text-[var(--tv-text)] hover:bg-[var(--tv-hover)]"
                }`}
              >
                {mode === "DEFAULT" ? "ALL" : mode === "GAINERS" ? "TOP+" : mode === "LOSERS" ? "TOP-" : "VOL"}
              </button>
            ))}
          </div>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[var(--tv-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter ticker or sector..."
            enterKeyHint="search"
            className="w-full pl-8 pr-2.5 py-1 rounded bg-[var(--tv-surface)] border border-[var(--tv-border)] text-xs text-[var(--tv-text)] placeholder-[var(--tv-muted)] focus:outline-none focus:border-[#2962FF]"
          />
        </div>
      </div>

      {/* TradingView Columns Header */}
      <div className="grid grid-cols-[1fr_70px_62px_62px] px-3 py-1.5 border-b border-[var(--tv-border)] text-[10px] font-medium text-[var(--tv-muted)] shrink-0">
        <span>Symbol</span>
        <span className="text-right">Last</span>
        <span className="text-right">Chg</span>
        <span className="text-right">Chg%</span>
      </div>

      {/* Dense Watchlist Rows */}
      <div className="flex-1 overflow-y-auto scroller divide-y divide-[var(--tv-border)]/45">
        {filteredList.map((st) => {
          const isSelected = st.symbol === selectedSymbol;
          const isUp = st.change_pct >= 0;
          const absChg = st.price - st.base_price;
          const flashClass =
            st.tick_delta_pct > 0 ? "tick-flash-up" : st.tick_delta_pct < 0 ? "tick-flash-down" : "";
          const badgeColor = getSymbolBadgeColor(st.symbol);

          return (
            <button
              key={st.symbol}
              type="button"
              onClick={() => setSelectedSymbol(st.symbol)}
              className={`w-full px-3 py-1.5 grid grid-cols-[1fr_70px_62px_62px] items-center text-left transition-colors ${flashClass} ${
                isSelected
                  ? "bg-[#2962FF]/10 border-l-2 border-l-[#2962FF]"
                  : "hover:bg-[var(--tv-hover)]/70"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0 pr-1">
                <span
                  className="w-4 h-4 rounded-full text-[8px] font-bold text-white flex items-center justify-center shrink-0"
                  style={{ backgroundColor: badgeColor }}
                >
                  {st.symbol.slice(0, 2)}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-mono font-semibold text-xs text-[var(--tv-text)] truncate">
                      {st.symbol}
                    </span>
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        isUp ? "bg-[#089981]" : "bg-[#F23645]"
                      }`}
                    />
                  </div>
                </div>
              </div>

              <span className="text-right font-mono text-xs font-semibold text-[var(--tv-text)] tabular-nums">
                {st.price.toFixed(2)}
              </span>

              <span
                className={`text-right font-mono text-[11px] tabular-nums ${
                  isUp ? "text-[#089981]" : "text-[#F23645]"
                }`}
              >
                {absChg >= 0 ? "+" : ""}
                {absChg.toFixed(2)}
              </span>

              <span
                className={`text-right font-mono text-[11px] font-medium tabular-nums ${
                  isUp ? "text-[#089981]" : "text-[#F23645]"
                }`}
              >
                {isUp ? "+" : ""}
                {st.change_pct.toFixed(2)}%
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
