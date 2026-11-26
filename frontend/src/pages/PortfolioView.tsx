import { useState } from "react";
import { ArrowUpRight, Briefcase, Coins, Layers, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "../lib/gateway";
import { HoldingItem } from "../lib/types";
import { useMarketStore } from "../store/useMarketStore";

interface Props {
  onOpenTickerInFloor: (symbol: string) => void;
}

export function PortfolioView({ onOpenTickerInFloor }: Props) {
  const [exitingKey, setExitingKey] = useState<string | null>(null);
  const portfolio = useMarketStore((s) => s.portfolio);
  const transactions = useMarketStore((s) => s.transactions);
  const stocks = useMarketStore((s) => s.stocks);
  const applyPortfolioUpdate = useMarketStore((s) => s.applyPortfolioUpdate);

  const holdings = portfolio?.holdings ?? [];
  const cash = portfolio?.cash_balance ?? 0;
  const collateral = portfolio?.collateral_locked ?? 0;
  const longVal = portfolio?.long_value ?? 0;
  const netWorth = portfolio?.net_worth ?? 25000;
  const totalCredited = portfolio?.total_credited ?? 25000;
  const totalPnl = netWorth - totalCredited;
  const totalPnlPct = totalCredited > 0 ? (totalPnl / totalCredited) * 100 : 0;

  const handleExitPosition = async (h: HoldingItem) => {
    const key = `${h.symbol}-${h.position_type}`;
    setExitingKey(key);
    const exitAction = h.position_type === "LONG" ? "SELL" : "COVER";
    const clientOrderId = crypto.randomUUID ? crypto.randomUUID() : `pf-exit-${Date.now()}-${Math.random()}`;
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
      toast.success(`Exited ${h.quantity} ${h.symbol} @ ₹${res.execution_price.toFixed(2)}`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to close position");
    } finally {
      setExitingKey(null);
    }
  };

  return (
    <div className="flex-1 p-4 space-y-4 overflow-y-auto scroller bg-[var(--tv-bg)] text-[var(--tv-text)]">
      {/* Portfolio KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border border-[var(--tv-border)] rounded-lg bg-[var(--tv-surface)] divide-y lg:divide-y-0 lg:divide-x divide-[var(--tv-border)] overflow-hidden">
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--tv-muted)] flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-[#089981]" /> Total Net Worth
          </div>
          <div className="text-2xl font-mono font-bold text-[var(--tv-text)] mt-1 tabular-nums">
            ₹{netWorth.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div
            className={`text-xs font-mono font-semibold mt-0.5 tabular-nums ${
              totalPnl >= 0 ? "text-[#089981]" : "text-[#F23645]"
            }`}
          >
            {totalPnl >= 0 ? "+" : ""}₹{totalPnl.toFixed(2)} ({totalPnl >= 0 ? "+" : ""}
            {totalPnlPct.toFixed(2)}%)
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--tv-muted)] flex items-center gap-1.5">
            <Coins className="w-3.5 h-3.5 text-[#089981]" /> Available Free Cash
          </div>
          <div className="text-2xl font-mono font-bold text-[#089981] mt-1 tabular-nums">
            ₹{cash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-[var(--tv-muted)] font-mono mt-0.5">
            Credited: ₹{totalCredited.toLocaleString("en-IN")}
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--tv-muted)] flex items-center gap-1.5">
            <Briefcase className="w-3.5 h-3.5 text-[#2962FF]" /> Deployed Equity & Escrow
          </div>
          <div className="text-2xl font-mono font-bold text-[var(--tv-text)] mt-1 tabular-nums">
            ₹{(longVal + collateral).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-[var(--tv-muted)] font-mono mt-0.5 tabular-nums">
            Long ₹{longVal.toLocaleString("en-IN")} · Escrow ₹{collateral.toLocaleString("en-IN")}
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--tv-muted)] flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-[var(--tv-text)]" /> Open Positions
          </div>
          <div className="text-2xl font-mono font-bold text-[var(--tv-text)] mt-1 tabular-nums">
            {holdings.length}
          </div>
          <div className="text-[11px] text-[var(--tv-muted)] font-mono mt-0.5">
            Shares Held: {holdings.reduce((s, h) => s + h.quantity, 0)}
          </div>
        </div>
      </div>

      {/* Full Holdings Breakdown Table */}
      <section className="bg-[var(--tv-surface)] border border-[var(--tv-border)] rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[var(--tv-border)] flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--tv-text)]">
            Stock Holdings & Live Valuation ({holdings.length})
          </h2>
          <span className="text-[11px] font-mono text-[var(--tv-muted)]">
            Mark-to-market 1s live feed
          </span>
        </div>

        {holdings.length === 0 ? (
          <div className="p-8 text-center text-xs text-[var(--tv-muted)]">
            No open positions. Switch to Supercharts to enter LONG or SHORT trades.
          </div>
        ) : (
          <div className="overflow-x-auto scroller">
            <table className="w-full text-left border-separate border-spacing-0 text-xs">
              <thead className="bg-[var(--tv-bg)] text-[10px] uppercase tracking-wider text-[var(--tv-muted)]">
                <tr>
                  <th className="py-2 px-4 border-b border-[var(--tv-border)]">Ticker</th>
                  <th className="py-2 px-3 border-b border-[var(--tv-border)]">Side</th>
                  <th className="py-2 px-3 border-b border-[var(--tv-border)] text-right">Qty</th>
                  <th className="py-2 px-3 border-b border-[var(--tv-border)] text-right">Avg Entry</th>
                  <th className="py-2 px-3 border-b border-[var(--tv-border)] text-right">Last</th>
                  <th className="py-2 px-3 border-b border-[var(--tv-border)] text-right">Value</th>
                  <th className="py-2 px-3 border-b border-[var(--tv-border)] text-right">Unrealized P&L</th>
                  <th className="py-2 px-4 border-b border-[var(--tv-border)] text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--tv-border)]/50">
                {holdings.map((h) => {
                  const key = `${h.symbol}-${h.position_type}`;
                  const info = stocks[h.symbol];
                  const isProfit = h.unrealized_pnl >= 0;
                  return (
                    <tr key={key} className="hover:bg-[var(--tv-hover)] transition-colors">
                      <th scope="row" className="py-2.5 px-4 text-left">
                        <div className="font-mono font-bold text-sm text-[var(--tv-text)]">{h.symbol}</div>
                        <div className="text-[11px] font-normal text-[var(--tv-muted)]">
                          {info?.company_name || h.symbol} · {info?.sector || "Equity"}
                        </div>
                      </th>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            h.position_type === "LONG"
                              ? "bg-[#089981]/15 text-[#089981]"
                              : "bg-[#F59E0B]/15 text-[#F59E0B]"
                          }`}
                        >
                          {h.position_type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-[var(--tv-text)] tabular-nums">
                        {h.quantity} / 40
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-[var(--tv-muted)] tabular-nums">
                        ₹{h.avg_entry_price.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-[var(--tv-text)] tabular-nums">
                        ₹{h.current_price.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-[var(--tv-text)] tabular-nums">
                        ₹{h.market_value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-mono font-bold tabular-nums ${
                          isProfit ? "text-[#089981]" : "text-[#F23645]"
                        }`}
                      >
                        {isProfit ? "+" : ""}₹{h.unrealized_pnl.toFixed(2)} ({isProfit ? "+" : ""}
                        {h.pnl_pct.toFixed(2)}%)
                      </td>
                      <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onOpenTickerInFloor(h.symbol)}
                          className="px-2.5 py-1 rounded bg-[var(--tv-bg)] hover:bg-[var(--tv-hover)] border border-[var(--tv-border)] text-[var(--tv-text)] text-[11px] font-semibold inline-flex items-center gap-1"
                        >
                          Chart <ArrowUpRight className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={exitingKey === key}
                          onClick={() => handleExitPosition(h)}
                          className="px-2.5 py-1 rounded bg-[#F23645]/15 hover:bg-[#F23645] text-[#F23645] hover:text-white text-[11px] font-bold transition-colors disabled:opacity-50"
                        >
                          {exitingKey === key ? "Exiting..." : "Close 100%"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Complete Recent Order Ledger */}
      <section className="bg-[var(--tv-surface)] border border-[var(--tv-border)] rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[var(--tv-border)]">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--tv-text)]">
            Executed Trade History ({transactions.length})
          </h2>
        </div>
        <div className="overflow-x-auto scroller max-h-[280px]">
          <table className="w-full text-left border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 bg-[var(--tv-bg)] text-[10px] uppercase text-[var(--tv-muted)]">
              <tr>
                <th className="py-2 px-4 border-b border-[var(--tv-border)]">Time</th>
                <th className="py-2 px-3 border-b border-[var(--tv-border)]">Ticker</th>
                <th className="py-2 px-3 border-b border-[var(--tv-border)]">Action</th>
                <th className="py-2 px-3 border-b border-[var(--tv-border)] text-right">Qty</th>
                <th className="py-2 px-3 border-b border-[var(--tv-border)] text-right">Fill Price</th>
                <th className="py-2 px-3 border-b border-[var(--tv-border)] text-right">Value</th>
                <th className="py-2 px-4 border-b border-[var(--tv-border)] text-right">Realized P&L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--tv-border)]/50">
              {transactions.map((t) => (
                <tr key={t.id} className="hover:bg-[var(--tv-hover)]">
                  <td className="py-2 px-4 font-mono text-[11px] text-[var(--tv-muted)] tabular-nums">
                    {new Date(t.created_at).toLocaleTimeString("en-IN", { hour12: false })}
                  </td>
                  <th scope="row" className="py-2 px-3 font-mono font-bold text-[var(--tv-text)]">
                    {t.symbol}
                  </th>
                  <td className="py-2 px-3">
                    <span
                      className={`font-mono font-bold text-[11px] ${
                        t.action === "BUY" || t.action === "COVER" ? "text-[#089981]" : "text-[#F23645]"
                      }`}
                    >
                      {t.action}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-[var(--tv-text)]">
                    {t.quantity}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-[var(--tv-text)]">
                    ₹{t.execution_price.toFixed(2)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-[var(--tv-muted)]">
                    ₹{t.total_amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                  <td
                    className={`py-2 px-4 text-right font-mono tabular-nums ${
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
        </div>
      </section>
    </div>
  );
}
