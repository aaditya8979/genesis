import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "../lib/gateway";
import { HoldingItem } from "../lib/types";
import { useMarketStore } from "../store/useMarketStore";

export function HoldingsBlotter() {
  const [activeTab, setActiveTab] = useState<"POSITIONS" | "ORDERS">("POSITIONS");
  const [collapsed, setCollapsed] = useState(false);
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
    <section className="bg-[var(--tv-bg)] border-t border-[var(--tv-border)] flex flex-col min-w-0 shrink-0">
      <div className="px-3 border-b border-[var(--tv-border)] flex items-center justify-between h-9">
        <div role="tablist" aria-label="Positions and executed orders" className="flex items-center gap-4 h-full">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "POSITIONS"}
            onClick={() => {
              setActiveTab("POSITIONS");
              setCollapsed(false);
            }}
            className="h-full px-1 text-xs font-semibold text-[var(--tv-muted)] hover:text-[var(--tv-text)] transition-colors"
          >
            Positions ({holdings.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "ORDERS"}
            onClick={() => {
              setActiveTab("ORDERS");
              setCollapsed(false);
            }}
            className="h-full px-1 text-xs font-semibold text-[var(--tv-muted)] hover:text-[var(--tv-text)] transition-colors"
          >
            Order History ({transactions.length})
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono text-[var(--tv-muted)] tabular-nums hidden sm:inline">
            Escrow:{" "}
            <strong className="text-[var(--tv-text)]">
              ₹{(portfolio?.collateral_locked ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </strong>
          </span>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand positions panel" : "Collapse positions panel"}
            className="p-1 rounded hover:bg-[var(--tv-hover)] text-[var(--tv-muted)] hover:text-[var(--tv-text)] transition-colors"
          >
            {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div
          tabIndex={0}
          role="region"
          aria-label="Portfolio holdings and orders"
          className="overflow-auto scroller max-h-[170px]"
          style={{ containerType: "inline-size" }}
        >
          {activeTab === "POSITIONS" ? (
            holdings.length === 0 ? (
              <div className="p-4 text-center text-xs text-[var(--tv-muted)]">
                No open positions yet. Click any ticker in Watchlist or use the floating Buy/Sell buttons to trade.
              </div>
            ) : (
              <table className="w-full text-left border-separate border-spacing-0 text-xs">
                <thead className="sticky top-0 z-10 bg-[var(--tv-bg)] text-[10px] uppercase tracking-wider text-[var(--tv-muted)]">
                  <tr>
                    <th className="py-1.5 px-3 border-b border-[var(--tv-border)]">Symbol</th>
                    <th className="py-1.5 px-3 border-b border-[var(--tv-border)]">Side</th>
                    <th className="py-1.5 px-3 border-b border-[var(--tv-border)] text-right">Qty</th>
                    <th className="py-1.5 px-3 border-b border-[var(--tv-border)] text-right">Avg Entry</th>
                    <th className="py-1.5 px-3 border-b border-[var(--tv-border)] text-right">Last</th>
                    <th className="py-1.5 px-3 border-b border-[var(--tv-border)] text-right">Unrealized P&amp;L</th>
                    <th className="py-1.5 px-3 border-b border-[var(--tv-border)] text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--tv-border)]/50">
                  {holdings.map((h) => {
                    const key = `${h.symbol}-${h.position_type}`;
                    const isProfit = h.unrealized_pnl >= 0;
                    return (
                      <tr key={key} className="hover:bg-[var(--tv-hover)]/60 transition-colors">
                        <th className="py-2 px-3 font-mono font-bold text-[var(--tv-text)] text-left">
                          <button
                            type="button"
                            onClick={() => setSelectedSymbol(h.symbol)}
                            className="hover:text-[#2962FF] transition-colors"
                          >
                            {h.symbol}
                          </button>
                        </th>
                        <td className="py-2 px-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              h.position_type === "LONG"
                                ? "bg-[#089981]/15 text-[#089981]"
                                : "bg-[#F59E0B]/15 text-[#F59E0B]"
                            }`}
                          >
                            {h.position_type}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-[var(--tv-text)]">
                          {h.quantity}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-[var(--tv-muted)]">
                          ₹{h.avg_entry_price.toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-[var(--tv-text)]">
                          ₹{h.current_price.toFixed(2)}
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-mono font-semibold tabular-nums ${
                            isProfit ? "text-[#089981]" : "text-[#F23645]"
                          }`}
                        >
                          {isProfit ? "+" : ""}₹{h.unrealized_pnl.toFixed(2)} ({isProfit ? "+" : ""}
                          {h.pnl_pct.toFixed(2)}%)
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            type="button"
                            disabled={exitingKey === key}
                            onClick={() => handleQuickExit(h)}
                            className="px-2 py-0.5 rounded bg-[var(--tv-surface)] border border-[var(--tv-border)] hover:border-[#F23645] hover:bg-[#F23645] hover:text-white text-[11px] font-semibold text-[var(--tv-text)] transition-colors disabled:opacity-50"
                          >
                            {exitingKey === key ? "Closing..." : "Close"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : transactions.length === 0 ? (
            <div className="p-4 text-center text-xs text-[var(--tv-muted)]">No trades executed yet.</div>
          ) : (
            <table className="w-full text-left border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 z-10 bg-[var(--tv-bg)] text-[10px] uppercase tracking-wider text-[var(--tv-muted)]">
                <tr>
                  <th className="py-1.5 px-3 border-b border-[var(--tv-border)]">Time</th>
                  <th className="py-1.5 px-3 border-b border-[var(--tv-border)]">Symbol</th>
                  <th className="py-1.5 px-3 border-b border-[var(--tv-border)]">Side</th>
                  <th className="py-1.5 px-3 border-b border-[var(--tv-border)] text-right">Qty</th>
                  <th className="py-1.5 px-3 border-b border-[var(--tv-border)] text-right">Fill Price</th>
                  <th className="py-1.5 px-3 border-b border-[var(--tv-border)] text-right">Realized P&amp;L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--tv-border)]/50">
                {transactions.map((t) => (
                  <tr key={t.id} className="hover:bg-[var(--tv-hover)]/50">
                    <td className="py-1.5 px-3 font-mono text-[11px] text-[var(--tv-muted)] tabular-nums">
                      {new Date(t.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </td>
                    <th className="py-1.5 px-3 font-mono font-bold text-[var(--tv-text)]">{t.symbol}</th>
                    <td className="py-1.5 px-3">
                      <span
                        className={`font-mono font-bold text-[11px] ${
                          t.action === "BUY" || t.action === "COVER" ? "text-[#089981]" : "text-[#F23645]"
                        }`}
                      >
                        {t.action}
                      </span>
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums text-[var(--tv-text)]">
                      {t.quantity}
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums text-[var(--tv-text)]">
                      ₹{t.execution_price.toFixed(2)}
                    </td>
                    <td
                      className={`py-1.5 px-3 text-right font-mono tabular-nums ${
                        t.realized_pnl > 0
                          ? "text-[#089981]"
                          : t.realized_pnl < 0
                          ? "text-[#F23645]"
                          : "text-[var(--tv-muted)]"
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
      )}
    </section>
  );
}
