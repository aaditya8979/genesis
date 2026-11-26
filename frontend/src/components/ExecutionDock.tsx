import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Lock, ShieldAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "../lib/gateway";
import { getSymbolBadgeColor } from "../lib/theme";
import { PreferredOrderSide, useMarketStore } from "../store/useMarketStore";

type InspectorTab = "TRADE" | "STATS";

export function ExecutionDock() {
  const preferredOrderTab = useMarketStore((s) => s.preferredOrderTab);
  const [tab, setTab] = useState<PreferredOrderSide>(preferredOrderTab);
  const [panelTab, setPanelTab] = useState<InspectorTab>("TRADE");
  const [qty, setQty] = useState<number>(5);
  const [submitting, setSubmitting] = useState(false);

  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const stock = useMarketStore((s) => s.stocks[s.selectedSymbol]);
  const portfolio = useMarketStore((s) => s.portfolio);
  const isMarketOpen = useMarketStore((s) => s.isMarketOpen);
  const isFrozen = useMarketStore((s) => s.user?.is_frozen ?? false);
  const activeScenarioName = useMarketStore((s) => s.activeScenarioName);
  const applyPortfolioUpdate = useMarketStore((s) => s.applyPortfolioUpdate);

  useEffect(() => {
    setTab(preferredOrderTab);
    setPanelTab("TRADE");
  }, [preferredOrderTab]);

  const existingLong = portfolio?.holdings.find(
    (h) => h.symbol === selectedSymbol && h.position_type === "LONG"
  );
  const existingShort = portfolio?.holdings.find(
    (h) => h.symbol === selectedSymbol && h.position_type === "SHORT"
  );

  const price = stock?.price ?? 0;
  const basePrice = stock?.base_price ?? price;
  const absChg = price - basePrice;
  const isUp = (stock?.change_pct ?? 0) >= 0;
  const orderValue = Number((qty * price).toFixed(2));
  const cash = portfolio?.cash_balance ?? 0;
  const netWorth = Math.max(portfolio?.net_worth ?? 25000, 25000);
  const maxSingleCap = netWorth * 0.35;

  const maxAllowedQty = useMemo(() => {
    if (!price || price <= 0) return 0;
    if (tab === "SELL") return existingLong?.quantity ?? 0;
    if (tab === "COVER") return existingShort?.quantity ?? 0;

    const currentPosQty = tab === "BUY" ? existingLong?.quantity ?? 0 : existingShort?.quantity ?? 0;
    const byCash = Math.floor(cash / price);
    const byCap = Math.floor(maxSingleCap / price) - currentPosQty;
    const byShareCap = 40 - currentPosQty;
    return Math.max(0, Math.min(byCash, byCap, byShareCap));
  }, [tab, price, cash, maxSingleCap, existingLong, existingShort]);

  const applyPct = (pct: number) => {
    const calculated = Math.max(1, Math.floor(maxAllowedQty * pct));
    setQty(Math.min(40, calculated));
  };

  const handleSubmit = async () => {
    if (!stock || qty <= 0) return;
    setSubmitting(true);
    const clientOrderId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    try {
      const res = await apiFetch<any>("/api/v1/trade/order", {
        method: "POST",
        body: JSON.stringify({
          symbol: selectedSymbol,
          action: tab,
          quantity: qty,
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
      toast.success(
        `${tab} ${qty} ${selectedSymbol} @ ₹${res.execution_price.toFixed(2)} FILLED`,
        { duration: 3000 }
      );
    } catch (err: any) {
      toast.error(err?.message || "Order rejected");
    } finally {
      setSubmitting(false);
    }
  };

  const buyPct = stock?.buy_pressure_pct ?? 50;
  const sellPct = Number((100 - buyPct).toFixed(1));
  const isBullishAction = tab === "BUY" || tab === "COVER";
  const badgeColor = getSymbolBadgeColor(selectedSymbol);

  return (
    <section className="bg-[var(--tv-bg)] border-t border-[var(--tv-border)] flex flex-col min-w-0">
      {/* TradingView Symbol Inspector Header */}
      <div className="px-3.5 pt-3 pb-2.5 border-b border-[var(--tv-border)]">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-6 h-6 rounded-full text-[10px] font-bold text-white flex items-center justify-center shrink-0"
              style={{ backgroundColor: badgeColor }}
            >
              {selectedSymbol.slice(0, 2)}
            </span>
            <div className="min-w-0">
              <div className="font-mono font-bold text-sm text-[var(--tv-text)] leading-tight">
                {selectedSymbol}
              </div>
              <div className="text-[11px] text-[var(--tv-muted)] truncate">
                {stock?.company_name} · {stock?.sector}
              </div>
            </div>
          </div>
        </div>

        {/* Bold TradingView Price Display */}
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-mono text-2xl font-bold text-[var(--tv-text)] tabular-nums tracking-tight">
            {price.toFixed(2)}
          </span>
          <span className="text-[10px] font-semibold uppercase text-[var(--tv-muted)]">INR</span>
          <span
            className={`font-mono text-xs font-semibold tabular-nums ${
              isUp ? "text-[#089981]" : "text-[#F23645]"
            }`}
          >
            {absChg >= 0 ? "+" : ""}
            {absChg.toFixed(2)} ({isUp ? "+" : ""}
            {(stock?.change_pct ?? 0).toFixed(2)}%)
          </span>
        </div>

        {/* 30s Crowd Volume Split Meter */}
        <div className="mt-2.5">
          <div className="flex items-center justify-between text-[10px] font-mono tabular-nums mb-1">
            <span className="text-[#089981] font-semibold">
              Buy Vol {stock?.buy_vol_30s ?? 0} ({buyPct.toFixed(0)}%)
            </span>
            <span className="text-[#F23645] font-semibold">
              Sell Vol {stock?.sell_vol_30s ?? 0} ({sellPct.toFixed(0)}%)
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-[#F23645]/80 overflow-hidden flex">
            <div
              className="h-full bg-[#089981] transition-all duration-300"
              style={{ width: `${buyPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Accessible Inspector Tabs */}
      <div
        role="tablist"
        aria-label="Order ticket and key stats"
        className="grid grid-cols-2 border-b border-[var(--tv-border)] text-xs font-semibold shrink-0"
      >
        <button
          type="button"
          role="tab"
          id="tab-trade"
          aria-selected={panelTab === "TRADE"}
          onClick={() => setPanelTab("TRADE")}
          className="py-2 text-center text-[var(--tv-muted)] hover:text-[var(--tv-text)] transition-colors"
        >
          Order Ticket
        </button>
        <button
          type="button"
          role="tab"
          id="tab-stats"
          aria-selected={panelTab === "STATS"}
          onClick={() => setPanelTab("STATS")}
          className="py-2 text-center text-[var(--tv-muted)] hover:text-[var(--tv-text)] transition-colors"
        >
          Key Stats &amp; Facts
        </button>
      </div>

      {/* Panel 1: Execution Dock */}
      <div
        role="tabpanel"
        aria-labelledby="tab-trade"
        hidden={panelTab !== "TRADE"}
        className="p-3.5 space-y-3"
      >
        <div className="grid grid-cols-4 gap-1 bg-[var(--tv-surface)] p-1 rounded border border-[var(--tv-border)]">
          {(["BUY", "SELL", "SHORT", "COVER"] as PreferredOrderSide[]).map((t) => {
            const active = tab === t;
            const activeStyle =
              t === "BUY" || t === "COVER"
                ? "bg-[#089981] text-white"
                : "bg-[#F23645] text-white";
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`py-1 rounded text-[11px] font-bold tracking-wide transition-colors ${
                  active ? activeStyle : "text-[var(--tv-muted)] hover:text-[var(--tv-text)]"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>

        <div>
          <div className="flex items-center justify-between text-[11px] mb-1">
            <label htmlFor="order-qty" className="text-[var(--tv-muted)] font-medium">
              Shares (Max 40)
            </label>
            <span className="font-mono text-[var(--tv-muted)] tabular-nums">
              Available: <strong className="text-[var(--tv-text)]">{maxAllowedQty}</strong>
            </span>
          </div>

          <input
            id="order-qty"
            type="number"
            min={1}
            max={40}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
            className="w-full px-3 py-1.5 rounded bg-[var(--tv-surface)] border border-[var(--tv-border)] font-mono text-sm font-bold text-[var(--tv-text)] tabular-nums focus:outline-none focus:border-[#2962FF]"
          />

          <div className="grid grid-cols-4 gap-1.5 mt-1.5">
            {[0.25, 0.5, 0.75, 1.0].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => applyPct(pct)}
                className="py-1 rounded bg-[var(--tv-surface)] hover:bg-[var(--tv-hover)] border border-[var(--tv-border)] text-[10px] font-mono font-semibold text-[var(--tv-muted)] hover:text-[var(--tv-text)] transition-colors"
              >
                {pct === 1.0 ? "MAX" : `${pct * 100}%`}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-[var(--tv-surface)] border border-[var(--tv-border)] rounded p-2.5 space-y-1.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-[var(--tv-muted)]">Spot LTP</span>
            <span className="font-mono text-[var(--tv-text)] tabular-nums">₹{price.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--tv-muted)]">
              {tab === "SHORT" ? "100% Margin Escrow" : "Order Value"}
            </span>
            <span className="font-mono font-bold text-[var(--tv-text)] tabular-nums">
              ₹{orderValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--tv-muted)]">Free Cash</span>
            <span className="font-mono font-semibold text-[#089981] tabular-nums">
              ₹{cash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {isFrozen && (
          <div className="p-2 rounded bg-[#F23645]/10 border border-[#F23645]/40 flex items-center gap-2 text-[11px] text-[#F23645]">
            <Lock className="w-3.5 h-3.5 shrink-0" />
            <span>Account frozen by Admin.</span>
          </div>
        )}

        {!isMarketOpen && (
          <div className="p-2 rounded bg-[#F59E0B]/10 border border-[#F59E0B]/40 flex items-center gap-2 text-[11px] text-[#F59E0B]">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>Market trading paused.</span>
          </div>
        )}

        <button
          type="button"
          disabled={submitting || !isMarketOpen || isFrozen}
          onClick={handleSubmit}
          className={`w-full py-2.5 rounded font-bold text-xs tracking-wide text-white transition-all disabled:opacity-50 active:scale-[0.99] ${
            isBullishAction ? "bg-[#089981] hover:bg-[#067A67]" : "bg-[#F23645] hover:bg-[#D62839]"
          }`}
        >
          {submitting
            ? "Executing Fill..."
            : `${tab} ${qty} ${selectedSymbol} @ ₹${price.toFixed(2)}`}
        </button>

        {tab === "SHORT" && (
          <p className="text-[10px] text-[var(--tv-muted)] flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />
            <span>100% cash escrow locked. Auto-liquidates at +80%.</span>
          </p>
        )}
      </div>

      {/* Panel 2: TradingView Key Facts Card & Key Stats */}
      <div
        role="tabpanel"
        aria-labelledby="tab-stats"
        hidden={panelTab !== "STATS"}
        className="p-3.5 space-y-2.5 text-xs"
      >
        <div className="p-3 rounded-lg bg-[#2962FF]/10 border border-[#2962FF]/25 space-y-1">
          <div className="text-[11px] font-semibold text-[#2962FF] flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Key facts
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--tv-text)]">
            {stock?.company_name || selectedSymbol} trades at{" "}
            <strong className="font-mono">₹{price.toFixed(2)}</strong> under{" "}
            <strong>{activeScenarioName}</strong>. 30s order flow sits at{" "}
            <strong className="font-mono text-[#089981]">{buyPct.toFixed(0)}% BUY</strong> vs{" "}
            <strong className="font-mono text-[#F23645]">{sellPct.toFixed(0)}% SELL</strong>.
          </p>
        </div>

        <div className="space-y-1.5 text-[11px]">
          <div className="flex justify-between py-1 border-b border-[var(--tv-border)]/50">
            <span className="text-[var(--tv-muted)]">Base / Anchor</span>
            <span className="font-mono text-[var(--tv-text)] tabular-nums">
              ₹{(stock?.base_price ?? 0).toFixed(2)} / ₹{(stock?.anchor_price ?? 0).toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between py-1 border-b border-[var(--tv-border)]/50">
            <span className="text-[var(--tv-muted)]">P/E Valuation</span>
            <span className="font-mono text-[var(--tv-text)] tabular-nums">
              {stock?.pe_ratio && stock.pe_ratio > 0 ? `${stock.pe_ratio}x` : "Unprofitable"}
            </span>
          </div>
          <div className="flex justify-between py-1 border-b border-[var(--tv-border)]/50">
            <span className="text-[var(--tv-muted)]">Session Volume</span>
            <span className="font-mono text-[var(--tv-text)] tabular-nums">
              {(stock?.total_volume ?? 0).toLocaleString()} sh
            </span>
          </div>
          <div className="flex justify-between py-1 border-b border-[var(--tv-border)]/50">
            <span className="text-[var(--tv-muted)]">35% Stock Cap Limit</span>
            <span className="font-mono text-[var(--tv-text)] tabular-nums">
              ₹{maxSingleCap.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-[var(--tv-muted)]">Your Open Holding</span>
            <span className="font-mono font-semibold text-[var(--tv-text)] tabular-nums">
              {existingLong
                ? `LONG ${existingLong.quantity} @ ₹${existingLong.avg_entry_price.toFixed(2)}`
                : existingShort
                ? `SHORT ${existingShort.quantity} @ ₹${existingShort.avg_entry_price.toFixed(2)}`
                : "Flat (0 shares)"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
