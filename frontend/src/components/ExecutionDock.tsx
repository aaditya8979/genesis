import { useMemo, useState } from "react";
import { AlertTriangle, Lock, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "../lib/gateway";
import { useMarketStore } from "../store/useMarketStore";

type OrderTab = "BUY" | "SELL" | "SHORT" | "COVER";

export function ExecutionDock() {
  const [tab, setTab] = useState<OrderTab>("BUY");
  const [qty, setQty] = useState<number>(5);
  const [submitting, setSubmitting] = useState(false);

  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const stock = useMarketStore((s) => s.stocks[s.selectedSymbol]);
  const portfolio = useMarketStore((s) => s.portfolio);
  const isMarketOpen = useMarketStore((s) => s.isMarketOpen);
  const isFrozen = useMarketStore((s) => s.user?.is_frozen ?? false);
  const applyPortfolioUpdate = useMarketStore((s) => s.applyPortfolioUpdate);

  const existingLong = portfolio?.holdings.find(
    (h) => h.symbol === selectedSymbol && h.position_type === "LONG"
  );
  const existingShort = portfolio?.holdings.find(
    (h) => h.symbol === selectedSymbol && h.position_type === "SHORT"
  );

  const price = stock?.price ?? 0;
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

  return (
    <div className="bg-[#121721] border border-[#232B3A] rounded-xl p-4 flex flex-col gap-3.5 min-w-0">
      {/* Live Crowd Quantity Pressure Meter */}
      <div className="bg-[#0B0E14] border border-[#232B3A] rounded-lg p-3">
        <div className="flex items-center justify-between text-[11px] font-semibold mb-1.5">
          <span className="text-[#00D09C] flex items-center gap-1 font-mono tabular-nums">
            <TrendingUp className="w-3.5 h-3.5" /> BUY {buyPct.toFixed(0)}% ({stock?.buy_vol_30s ?? 0})
          </span>
          <span className="text-[10px] uppercase tracking-wider text-[#8A94A6]">30s Crowd Flow</span>
          <span className="text-[#EB5B3C] flex items-center gap-1 font-mono tabular-nums">
            ({stock?.sell_vol_30s ?? 0}) {sellPct.toFixed(0)}% SELL <TrendingDown className="w-3.5 h-3.5" />
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-[#EB5B3C] overflow-hidden flex">
          <div
            className="h-full bg-[#00D09C] transition-all duration-300"
            style={{ width: `${buyPct}%` }}
          />
        </div>
      </div>

      {/* Action Tabs */}
      <div className="grid grid-cols-4 gap-1 bg-[#0B0E14] p-1 rounded-lg border border-[#232B3A]">
        {(["BUY", "SELL", "SHORT", "COVER"] as OrderTab[]).map((t) => {
          const active = tab === t;
          const activeColor =
            t === "BUY" || t === "COVER"
              ? "bg-[#00D09C] text-[#0B0E14]"
              : "bg-[#EB5B3C] text-white";
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`py-1.5 rounded-md text-xs font-bold tracking-wide transition-all ${
                active ? activeColor : "text-[#8A94A6] hover:text-white"
              }`}
            >
              {t}
            </button>
          );
        })}
      </div>

      {/* Quantity Input + Quick Percentage Chips */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1.5">
          <label htmlFor="order-qty" className="text-[#8A94A6] font-medium">
            Quantity (Max 40)
          </label>
          <span className="font-mono text-[#8A94A6] tabular-nums">
            Max Allowed: <strong className="text-white">{maxAllowedQty}</strong>
          </span>
        </div>

        <input
          id="order-qty"
          type="number"
          min={1}
          max={40}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
          className="w-full px-3 py-2.5 rounded-lg bg-[#0B0E14] border border-[#232B3A] font-mono text-base font-bold text-white tabular-nums focus:outline-none focus:border-[#00D09C]"
        />

        <div className="grid grid-cols-4 gap-1.5 mt-2">
          {[0.25, 0.5, 0.75, 1.0].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => applyPct(pct)}
              className="py-1.5 rounded-md bg-[#181E2B] hover:bg-[#232B3A] border border-[#232B3A] text-[11px] font-mono font-semibold text-[#8A94A6] hover:text-white transition-colors"
            >
              {pct === 1.0 ? "MAX" : `${pct * 100}%`}
            </button>
          ))}
        </div>
      </div>

      {/* Pre-Trade Breakdown */}
      <div className="bg-[#0B0E14] border border-[#232B3A] rounded-lg p-3 space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-[#8A94A6]">Spot Price ({selectedSymbol})</span>
          <span className="font-mono text-white tabular-nums">₹{price.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#8A94A6]">
            {tab === "SHORT" ? "100% Margin Escrow" : "Order Value"}
          </span>
          <span className="font-mono font-bold text-white tabular-nums">
            ₹{orderValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#8A94A6]">Free Cash</span>
          <span className="font-mono text-[#00D09C] tabular-nums">
            ₹{cash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#8A94A6]">35% Cap Limit</span>
          <span className="font-mono text-[#8A94A6] tabular-nums">
            ₹{maxSingleCap.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </span>
        </div>
      </div>

      {isFrozen && (
        <div className="p-2.5 rounded-lg bg-[#EB5B3C]/15 border border-[#EB5B3C]/40 flex items-center gap-2 text-xs text-[#EB5B3C]">
          <Lock className="w-4 h-4 shrink-0" />
          <span>Account temporarily frozen by Admin.</span>
        </div>
      )}

      {!isMarketOpen && (
        <div className="p-2.5 rounded-lg bg-[#F59E0B]/15 border border-[#F59E0B]/40 flex items-center gap-2 text-xs text-[#F59E0B]">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Market trading paused by Admin.</span>
        </div>
      )}

      <button
        type="button"
        disabled={submitting || !isMarketOpen || isFrozen}
        onClick={handleSubmit}
        className={`w-full py-3 rounded-lg font-bold text-sm tracking-wide transition-all disabled:opacity-50 active:scale-[0.99] ${
          isBullishAction
            ? "bg-[#00D09C] hover:bg-[#00B889] text-[#0B0E14]"
            : "bg-[#EB5B3C] hover:bg-[#D44D30] text-white"
        }`}
      >
        {submitting
          ? "Executing Atomic Fill..."
          : `${tab} ${qty} ${selectedSymbol} @ ₹${price.toFixed(2)}`}
      </button>

      {tab === "SHORT" && (
        <p className="text-[11px] text-[#8A94A6] flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />
          <span>100% cash escrow locked. Auto-covered if price surges +80%.</span>
        </p>
      )}
    </div>
  );
}

