import { useMemo, useState } from "react";
import { Search } from "lucide-react";
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
    <aside className="bg-[#121721] border border-[#232B3A] rounded-xl flex flex-col min-w-0 overflow-hidden h-full">
      <div className="p-3 border-b border-[#232B3A] space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-[#8A94A6]">Equities (30)</span>
          <span className="text-[11px] font-mono text-[#00D09C]">AMM LIVE</span>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#8A94A6] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ticker or sector..."
            enterKeyHint="search"
            className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-[#0B0E14] border border-[#232B3A] text-xs text-white placeholder-[#505B6F] focus:outline-none focus:border-[#00D09C]"
          />
        </div>

        <div className="grid grid-cols-4 gap-1 text-[10px] font-semibold">
          {(["DEFAULT", "GAINERS", "LOSERS", "VOLUME"] as SortMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSortMode(mode)}
              className={`py-1 rounded transition-colors ${
                sortMode === mode
                  ? "bg-[#232B3A] text-white"
                  : "text-[#8A94A6] hover:text-white hover:bg-[#181E2B]"
              }`}
            >
              {mode === "DEFAULT" ? "ALL" : mode === "GAINERS" ? "TOP +" : mode === "LOSERS" ? "TOP -" : "VOL"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroller divide-y divide-[#232B3A]/60">
        {filteredList.map((st) => {
          const isSelected = st.symbol === selectedSymbol;
          const isUp = st.change_pct >= 0;
          const flashClass =
            st.tick_delta_pct > 0 ? "tick-flash-up" : st.tick_delta_pct < 0 ? "tick-flash-down" : "";

          return (
            <button
              key={`${st.symbol}-${st.tick_delta_pct}`}
              type="button"
              onClick={() => setSelectedSymbol(st.symbol)}
              className={`w-full px-3 py-2.5 text-left flex items-center justify-between gap-2 transition-colors ${flashClass} ${
                isSelected ? "bg-[#181E2B] border-l-2 border-l-[#00D09C]" : "hover:bg-[#181E2B]/60"
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-xs text-white">{st.symbol}</span>
                  <span className="text-[10px] text-[#8A94A6] truncate">{st.sector}</span>
                </div>
                <div className="text-[11px] text-[#8A94A6] truncate">{st.company_name}</div>
              </div>

              <div className="text-right shrink-0">
                <div className="font-mono font-semibold text-xs text-white tabular-nums">
                  ₹{st.price.toFixed(2)}
                </div>
                <div
                  className={`font-mono text-[11px] font-medium tabular-nums ${
                    isUp ? "text-[#00D09C]" : "text-[#EB5B3C]"
                  }`}
                >
                  {isUp ? "+" : ""}
                  {st.change_pct.toFixed(2)}%
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

