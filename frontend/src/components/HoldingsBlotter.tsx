import { useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "../lib/gateway";
import { HoldingItem } from "../lib/types";
import { useMarketStore } from "../store/useMarketStore";

export function HoldingsBlotter() {
  const [activeTab, setActiveTab] = useState<"POSITIONS" | "ORDERS">("POSITIONS");
  const [exitingKey, setExitingKey] = useState<string | null>(null);

  const portfolio = useMarketStore((s) => s.portfolio);
  const transactions = useMarketStore((s) => s.transactions);
  const setSelectedSymbol = useMarketStore((s) => s.setSelectedSymbol);
  const applyPortfolioUpdate = useMarketStore((s) => s.applyPortfolioUpdate);

  const handleQuickExit = async (h: HoldingItem) => {
    const key = `${h.symbol}-${h.position_type}`;
    setExitingKey(key);
    const exitAction = h.position_type === "LONG" ? "SELL" : "COVER";
    const clientOrderId = crypto.randomUUID ? crypto.randomUUID() : `exit-${Date.now()}-${Math.random()}`;
    try {
      const res = await apiFetch<any>("/api/v1/trade/order", {
        method: "POST",
        body: JSON.stringify({
          symbol: h.symbol,
          action: exitAction,
          quantity: h.quantity,
          client_order_id: clientOrderId,
        }),
      });
      if (res.portfolio) {
        applyPortfolioUpdate(res.portfolio, {
          id: res.transaction_id,
          symbol: res.symbol,
          action: res.action,
          quantity: res.quantity,
          execution_price: res.execution_price,
          total_amount: res.total_amount,
          realized_pnl: res.realized_pnl,
          created_at: new Date().toISOString(),
        });
      }
      toast.success(`Closed ${h.quantity} ${h.symbol} (${h.position_type}) @ ₹${res.execution_price.toFixed(2)}`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to close position");
    } finally {
      setExitingKey(null);
    }
  };

  const holdings = portfolio?.holdings ?? [];

  return (
    <section className="bg-[#121721] border border-[#232B3A] rounded-xl flex flex-col min-w-0 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#232B3A] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("POSITIONS")}
            className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${
              activeTab === "POSITIONS"
                ? "bg-[#232B3A] text-white"
                : "text-[#8A94A6] hover:text-white"
            }`}
          >
            Open Positions ({holdings.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("ORDERS")}
            className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${
              activeTab === "ORDERS"
                ? "bg-[#232B3A] text-white"
                : "text-[#8A94A6] hover:text-white"
            }`}
          >
            Executed Orders ({transactions.length})
          </button>
        </div>

        <span className="text-[11px] font-mono text-[#8A94A6] tabular-nums hidden sm:inline">
          Escrow Collateral: <strong className="text-white">₹{(portfolio?.collateral_locked ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong>
        </span>
      </div>

      <div
        tabIndex={0}
        role="region"
        aria-label="Portfolio holdings and orders"
        className="overflow-auto scroller max-h-[240px]"
        style={{ containerType: "inline-size" }}
      >
        {activeTab === "POSITIONS" ? (
          holdings.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#8A94A6]">
              No open positions yet. Select a stock from the watchlist and execute a BUY or SHORT order.
            </div>
          ) : (
            <table className="w-full text-left border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 z-10 bg-[#121721] text-[10px] uppercase tracking-wider text-[#8A94A6]">
                <tr>
                  <th className="py-2 px-4 border-b border-[#232B3A]">Ticker</th>
                  <th className="py-2 px-3 border-b border-[#232B3A]">Side</th>
                  <th className="py-2 px-3 border-b border-[#232B3A] text-right">Qty</th>
                  <th className="py-2 px-3 border-b border-[#232B3A] text-right">Avg Entry</th>
                  <th className="py-2 px-3 border-b border-[#232B3A] text-right">LTP</th>
                  <th className="py-2 px-3 border-b border-[#232B3A] text-right">Unrealized P&L</th>
                  <th className="py-2 px-4 border-b border-[#232B3A] text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#232B3A]/50">
                {holdings.map((h) => {
                  const key = `${h.symbol}-${h.position_type}`;
                  const isProfit = h.unrealized_pnl >= 0;
                  return (
                    <tr key={key} className="hover:bg-[#181E2B]/60 transition-colors">
                      <th className="py-2.5 px-4 font-mono font-bold text-white text-left">
                        <button
                          type="button"
                          onClick={() => setSelectedSymbol(h.symbol)}
                          className="hover:text-[#00D09C] transition-colors"
                        >
                          {h.symbol}
                        </button>
                      </th>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            h.position_type === "LONG"
                              ? "bg-[#00D09C]/15 text-[#00D09C]"
                              : "bg-[#F59E0B]/15 text-[#F59E0B]"
                          }`}
                        >
                          {h.position_type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-white">{h.quantity}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#8A94A6]">
                        ₹{h.avg_entry_price.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-white">
                        ₹{h.current_price.toFixed(2)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-mono font-semibold tabular-nums ${
                          isProfit ? "text-[#00D09C]" : "text-[#EB5B3C]"
                        }`}
                      >
                        {isProfit ? "+" : ""}₹{h.unrealized_pnl.toFixed(2)} ({isProfit ? "+" : ""}
                        {h.pnl_pct.toFixed(2)}%)
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          disabled={exitingKey === key}
                          onClick={() => handleQuickExit(h)}
                          className="px-2.5 py-1 rounded bg-[#232B3A] hover:bg-[#EB5B3C] text-[11px] font-semibold text-white transition-colors disabled:opacity-50"
                        >
                          {exitingKey === key ? "Closing..." : "Exit 100%"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : transactions.length === 0 ? (
          <div className="p-6 text-center text-xs text-[#8A94A6]">No trades executed yet.</div>
        ) : (
          <table className="w-full text-left border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 z-10 bg-[#121721] text-[10px] uppercase tracking-wider text-[#8A94A6]">
              <tr>
                <th className="py-2 px-4 border-b border-[#232B3A]">Time</th>
                <th className="py-2 px-3 border-b border-[#232B3A]">Ticker</th>
                <th className="py-2 px-3 border-b border-[#232B3A]">Action</th>
                <th className="py-2 px-3 border-b border-[#232B3A] text-right">Qty</th>
                <th className="py-2 px-3 border-b border-[#232B3A] text-right">Fill Price</th>
                <th className="py-2 px-4 border-b border-[#232B3A] text-right">Realized P&L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#232B3A]/50">
              {transactions.map((t) => (
                <tr key={t.id} className="hover:bg-[#181E2B]/50">
                  <td className="py-2 px-4 font-mono text-[11px] text-[#8A94A6] tabular-nums">
                    {new Date(t.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </td>
                  <th className="py-2 px-3 font-mono font-bold text-white">{t.symbol}</th>
                  <td className="py-2 px-3">
                    <span
                      className={`font-mono font-bold text-[11px] ${
                        t.action === "BUY" || t.action === "COVER" ? "text-[#00D09C]" : "text-[#EB5B3C]"
                      }`}
                    >
                      {t.action}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-white">{t.quantity}</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-white">
                    ₹{t.execution_price.toFixed(2)}
                  </td>
                  <td
                    className={`py-2 px-4 text-right font-mono tabular-nums ${
                      t.realized_pnl > 0
                        ? "text-[#00D09C]"
                        : t.realized_pnl < 0
                        ? "text-[#EB5B3C]"
                        : "text-[#8A94A6]"
                    }`}
                  >
                    {t.realized_pnl !== 0
                      ? `${t.realized_pnl > 0 ? "+" : ""}₹${t.realized_pnl.toFixed(2)}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

