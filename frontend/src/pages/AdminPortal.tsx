import { FormEvent, useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Flame,
  Lock,
  PauseCircle,
  PlayCircle,
  Radio,
  Search,
  Send,
  Unlock,
  Wallet,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch, getActiveWsUrl } from "../lib/gateway";

interface Props {
  onBackTerminal: () => void;
}

export function AdminPortal({ onBackTerminal }: Props) {
  const [secretInput, setSecretInput] = useState(localStorage.getItem("genesis_admin_secret") || "");
  const [authorized, setAuthorized] = useState(Boolean(localStorage.getItem("genesis_admin_secret")));
  const [overview, setOverview] = useState<any>(null);

  // Instant Top-Up & Lookup State
  const [lookupReg, setLookupReg] = useState("");
  const [topupAmount, setTopupAmount] = useState(5000);
  const [lookedUpUser, setLookedUpUser] = useState<any>(null);

  // Market Controls State
  const [whaleSymbol, setWhaleSymbol] = useState("TMND");
  const [whaleSide, setWhaleSide] = useState<"BUY" | "SELL">("SELL");
  const [whaleQty, setWhaleQty] = useState(10000);
  const [overrideSymbol, setOverrideSymbol] = useState("TMND");
  const [overridePrice, setOverridePrice] = useState(180);
  const [broadcastText, setBroadcastText] = useState("");
  const [rosterSearch, setRosterSearch] = useState("");

  const fetchOverview = async () => {
    try {
      const data = await apiFetch<any>("/api/v1/admin/overview");
      setOverview(data);
    } catch (err: any) {
      if (err?.message?.includes("403") || err?.message?.includes("Admin")) {
        localStorage.removeItem("genesis_admin_secret");
        setAuthorized(false);
      }
    }
  };

  useEffect(() => {
    if (!authorized) return;
    fetchOverview();

    const secret = localStorage.getItem("genesis_admin_secret") || "";
    const ws = new WebSocket(getActiveWsUrl(`/ws/admin?secret=${encodeURIComponent(secret)}`));

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event === "ADMIN_TELEMETRY") setOverview(msg.data);
      } catch {
        // ignore
      }
    };

    const ping = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}');
    }, 15000);

    return () => {
      window.clearInterval(ping);
      ws.close();
    };
  }, [authorized]);

  const handleAdminAuth = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/v1/auth/admin-login", {
        method: "POST",
        body: JSON.stringify({ secret_key: secretInput.trim() }),
      });
      localStorage.setItem("genesis_admin_secret", secretInput.trim());
      setAuthorized(true);
      toast.success("Admin Command Center unlocked");
    } catch {
      toast.error("Invalid Admin Secret Key");
    }
  };

  const handleTopup = async (regNo: string, amount: number) => {
    if (!regNo.trim()) return;
    try {
      const res = await apiFetch<any>("/api/v1/admin/topup", {
        method: "POST",
        body: JSON.stringify({ registration_no: regNo.trim(), amount }),
      });
      toast.success(
        `Credited +₹${amount} to ${res.registration_no} (Delivered live to ${res.ws_delivered_tabs} tab(s))`
      );
      fetchOverview();
      if (lookedUpUser?.user?.registration_no === res.registration_no) {
        handleLookup(res.registration_no);
      }
    } catch (err: any) {
      toast.error(err?.message || "Top-up failed");
    }
  };

  const handleLookup = async (regNo: string) => {
    if (!regNo.trim()) return;
    try {
      const data = await apiFetch<any>(`/api/v1/admin/user/${encodeURIComponent(regNo.trim())}`);
      setLookedUpUser(data);
    } catch (err: any) {
      toast.error(err?.message || "Student not found");
    }
  };

  const handleFreezeToggle = async (regNo: string, nextFrozen: boolean) => {
    try {
      await apiFetch("/api/v1/admin/user/freeze", {
        method: "POST",
        body: JSON.stringify({ registration_no: regNo, is_frozen: nextFrozen }),
      });
      toast.warning(`${regNo} ${nextFrozen ? "FROZEN" : "UNFROZEN"} live`);
      fetchOverview();
      if (lookedUpUser?.user?.registration_no === regNo) {
        handleLookup(regNo);
      }
    } catch (err: any) {
      toast.error(err?.message || "Action failed");
    }
  };

  const triggerEra = async (eraId: string) => {
    try {
      const res = await apiFetch<any>("/api/v1/admin/scenario/trigger", {
        method: "POST",
        body: JSON.stringify({ era_id: eraId }),
      });
      toast.success(`${res.era} live! (${res.liquidations_triggered} short squeeze liquidations)`);
      fetchOverview();
    } catch (err: any) {
      toast.error(err?.message);
    }
  };

  const toggleMarket = async () => {
    const next = !(overview?.is_market_open ?? true);
    await apiFetch("/api/v1/admin/market/pause", {
      method: "PATCH",
      body: JSON.stringify({ is_market_open: next }),
    });
    toast.info(next ? "Market RESUMED" : "Market PAUSED globally");
    fetchOverview();
  };

  const toggleTicks = async () => {
    const next = !(overview?.ticks_enabled ?? true);
    await apiFetch("/api/v1/admin/ticks/toggle", {
      method: "PATCH",
      body: JSON.stringify({ ticks_enabled: next }),
    });
    toast.info(next ? "Organic Jitter ENABLED" : "Organic Jitter FROZEN");
    fetchOverview();
  };

  const fireWhale = async () => {
    try {
      const res = await apiFetch<any>("/api/v1/admin/whale", {
        method: "POST",
        body: JSON.stringify({ symbol: whaleSymbol, side: whaleSide, quantity: whaleQty }),
      });
      toast.warning(`Whale ${whaleSide} executed: ${res.symbol} ₹${res.before} -> ₹${res.after}`);
    } catch (err: any) {
      toast.error(err?.message);
    }
  };

  const fireOverride = async () => {
    try {
      const res = await apiFetch<any>("/api/v1/admin/price-override", {
        method: "POST",
        body: JSON.stringify({ symbol: overrideSymbol, target_price: overridePrice }),
      });
      toast.success(`Forced ${res.symbol} -> ₹${res.price}`);
    } catch (err: any) {
      toast.error(err?.message);
    }
  };

  const sendBroadcast = async (e: FormEvent) => {
    e.preventDefault();
    if (!broadcastText.trim()) return;
    await apiFetch("/api/v1/admin/broadcast", {
      method: "POST",
      body: JSON.stringify({ headline: broadcastText.trim() }),
    });
    toast.success("Headline pushed to all 1,000 screens");
    setBroadcastText("");
    fetchOverview();
  };

  if (!authorized) {
    return (
      <div className="min-h-[100dvh] bg-[#0B0E14] text-[#F3F5F8] flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-[#121721] border border-[#232B3A] rounded-2xl p-6">
          <h1 className="text-lg font-bold mb-1">Admin Command Desk</h1>
          <p className="text-xs text-[#8A94A6] mb-5">Enter organizer master key to control live market & top-ups.</p>
          <form onSubmit={handleAdminAuth} className="space-y-4">
            <input
              type="password"
              required
              placeholder="Admin Secret Key (genesis_admin_master_2026)"
              value={secretInput}
              onChange={(e) => setSecretInput(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-[#0B0E14] border border-[#232B3A] text-sm font-mono text-white focus:outline-none focus:border-[#00D09C]"
            />
            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-[#00D09C] text-[#0B0E14] font-bold text-sm"
            >
              Unlock Command Desk
            </button>
          </form>
          <button
            type="button"
            onClick={onBackTerminal}
            className="mt-4 text-xs text-[#8A94A6] hover:text-white flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Student Terminal
          </button>
        </div>
      </div>
    );
  }

  const participants = (overview?.participants || []).filter((p: any) => {
    const q = rosterSearch.trim().toLowerCase();
    if (!q) return true;
    return p.registration_no.toLowerCase().includes(q) || p.email.toLowerCase().includes(q);
  });

  return (
    <div className="min-h-[100dvh] bg-[#0B0E14] text-[#F3F5F8] p-4 space-y-4">
      {/* Top Bar */}
      <header className="bg-[#121721] border border-[#232B3A] rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackTerminal}
            className="px-2.5 py-1.5 rounded-lg bg-[#181E2B] hover:bg-[#232B3A] text-xs font-semibold flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Floor
          </button>
          <div>
            <h1 className="font-bold text-sm text-white">GENESIS 2026 — ADMIN WAR ROOM</h1>
            <p className="text-[11px] text-[#8A94A6]">{overview?.active_scenario_name || "Loading..."}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleMarket}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              overview?.is_market_open
                ? "bg-[#EB5B3C]/20 text-[#EB5B3C] border border-[#EB5B3C]/40"
                : "bg-[#00D09C] text-[#0B0E14]"
            }`}
          >
            {overview?.is_market_open ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
            {overview?.is_market_open ? "PAUSE MARKET" : "RESUME MARKET"}
          </button>

          <button
            type="button"
            onClick={toggleTicks}
            className="px-3 py-1.5 rounded-lg bg-[#181E2B] border border-[#232B3A] text-xs font-semibold text-white hover:bg-[#232B3A]"
          >
            Jitter: {overview?.ticks_enabled ? "ON" : "FROZEN"}
          </button>
        </div>
      </header>

      {/* Telemetry KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[#121721] border border-[#232B3A] rounded-xl p-3.5">
          <div className="text-[11px] text-[#8A94A6] flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-[#00D09C]" /> Live Concurrent Sockets
          </div>
          <div className="text-2xl font-mono font-bold text-white mt-1 tabular-nums">
            {overview?.active_sockets ?? 0}
          </div>
          <div className="text-[10px] text-[#8A94A6] font-mono">
            Evicted slow clients: {overview?.evicted_slow_clients ?? 0}
          </div>
        </div>

        <div className="bg-[#121721] border border-[#232B3A] rounded-xl p-3.5">
          <div className="text-[11px] text-[#8A94A6] flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-[#F59E0B]" /> Registered Traders
          </div>
          <div className="text-2xl font-mono font-bold text-white mt-1 tabular-nums">
            {overview?.registered_count ?? 0}
          </div>
          <div className="text-[10px] text-[#8A94A6] font-mono">
            Orders/sec: {overview?.orders_per_sec ?? 0}
          </div>
        </div>

        <div className="bg-[#121721] border border-[#232B3A] rounded-xl p-3.5">
          <div className="text-[11px] text-[#8A94A6] flex items-center gap-1.5">
            <Wallet className="w-3.5 h-3.5 text-[#00D09C]" /> Total Cash & Escrow
          </div>
          <div className="text-2xl font-mono font-bold text-white mt-1 tabular-nums">
            ₹{(overview?.total_cash_circulation ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </div>
        </div>

        <div className="bg-[#121721] border border-[#232B3A] rounded-xl p-3.5">
          <div className="text-[11px] text-[#8A94A6] flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-[#EB5B3C]" /> Live Headline Broadcast
          </div>
          <form onSubmit={sendBroadcast} className="flex gap-1.5 mt-1.5">
            <input
              type="text"
              placeholder="Push alert to all..."
              value={broadcastText}
              onChange={(e) => setBroadcastText(e.target.value)}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded bg-[#0B0E14] border border-[#232B3A] text-xs text-white"
            />
            <button type="submit" className="px-2.5 py-1.5 rounded bg-[#F59E0B] text-[#0B0E14] font-bold">
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>

      {/* Main Controls Row: Top-Up Desk + Era Triggers + Whale/Override */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Instant Top-Up & User Inspector */}
        <section className="bg-[#121721] border border-[#232B3A] rounded-xl p-4 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#00D09C]">
            Instant Real-Time Wallet Top-Up
          </h2>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Reg No (e.g. 25BCE10421)"
              value={lookupReg}
              onChange={(e) => setLookupReg(e.target.value.toUpperCase())}
              className="flex-1 px-3 py-2 rounded-lg bg-[#0B0E14] border border-[#232B3A] font-mono text-xs uppercase text-white"
            />
            <button
              type="button"
              onClick={() => handleLookup(lookupReg)}
              className="px-3 py-2 rounded-lg bg-[#181E2B] hover:bg-[#232B3A] text-xs font-semibold flex items-center gap-1"
            >
              <Search className="w-3.5 h-3.5" /> Inspect
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="number"
              value={topupAmount}
              onChange={(e) => setTopupAmount(Number(e.target.value) || 0)}
              className="w-28 px-3 py-2 rounded-lg bg-[#0B0E14] border border-[#232B3A] font-mono text-xs text-white"
            />
            {[5000, 10000].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handleTopup(lookupReg, preset)}
                className="px-2.5 py-2 rounded-lg bg-[#00D09C]/15 hover:bg-[#00D09C]/25 border border-[#00D09C]/30 text-[#00D09C] font-mono text-xs font-bold"
              >
                +₹{preset / 1000}k
              </button>
            ))}
            <button
              type="button"
              onClick={() => handleTopup(lookupReg, topupAmount)}
              className="flex-1 py-2 rounded-lg bg-[#00D09C] text-[#0B0E14] text-xs font-bold"
            >
              Credit Live
            </button>
          </div>

          {lookedUpUser && (
            <div className="p-3 rounded-lg bg-[#0B0E14] border border-[#232B3A] text-xs space-y-1.5">
              <div className="flex justify-between font-mono">
                <span className="font-bold text-white">{lookedUpUser.user.registration_no}</span>
                <button
                  type="button"
                  onClick={() => handleFreezeToggle(lookedUpUser.user.registration_no, !lookedUpUser.user.is_frozen)}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 ${
                    lookedUpUser.user.is_frozen
                      ? "bg-[#00D09C]/20 text-[#00D09C]"
                      : "bg-[#EB5B3C]/20 text-[#EB5B3C]"
                  }`}
                >
                  {lookedUpUser.user.is_frozen ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                  {lookedUpUser.user.is_frozen ? "UNFREEZE" : "FREEZE"}
                </button>
              </div>
              <div className="text-[#8A94A6] truncate">{lookedUpUser.user.email}</div>
              <div className="flex justify-between pt-1 font-mono tabular-nums">
                <span>Cash: ₹{lookedUpUser.portfolio.cash_balance.toLocaleString("en-IN")}</span>
                <span className="text-[#00D09C]">Net: ₹{lookedUpUser.portfolio.net_worth.toLocaleString("en-IN")}</span>
              </div>
            </div>
          )}
        </section>

        {/* 10 Chronological Era Triggers */}
        <section className="bg-[#121721] border border-[#232B3A] rounded-xl p-4 space-y-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#F59E0B] flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" /> Atomic Era Shock Triggers (Sub-50ms)
          </h2>
          <div className="grid grid-cols-2 gap-1.5 max-h-[220px] overflow-y-auto scroller pr-1">
            {(overview?.eras || []).map((era: any) => {
              const isActive = overview?.active_era_id === era.id;
              return (
                <button
                  key={era.id}
                  type="button"
                  onClick={() => triggerEra(era.id)}
                  className={`p-2 rounded-lg text-left border text-[11px] transition-all ${
                    isActive
                      ? "bg-[#F59E0B]/20 border-[#F59E0B] text-white"
                      : era.severity === "CRASH"
                      ? "bg-[#EB5B3C]/10 hover:bg-[#EB5B3C]/20 border-[#EB5B3C]/30 text-[#F3F5F8]"
                      : "bg-[#00D09C]/10 hover:bg-[#00D09C]/20 border-[#00D09C]/30 text-[#F3F5F8]"
                  }`}
                >
                  <div className="font-bold truncate">{era.name}</div>
                  <div className="text-[9px] font-mono opacity-75">{era.severity}</div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Whale Simulator & Manual Price Override */}
        <section className="bg-[#121721] border border-[#232B3A] rounded-xl p-4 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#EB5B3C]">
            Whale Injection & Price Override
          </h2>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={whaleSymbol}
              onChange={(e) => setWhaleSymbol(e.target.value.toUpperCase())}
              className="w-20 px-2.5 py-1.5 rounded bg-[#0B0E14] border border-[#232B3A] font-mono text-xs uppercase text-white"
            />
            <select
              value={whaleSide}
              onChange={(e) => setWhaleSide(e.target.value as "BUY" | "SELL")}
              className="px-2 py-1.5 rounded bg-[#0B0E14] border border-[#232B3A] font-mono text-xs text-white"
            >
              <option value="SELL">DUMP (SELL)</option>
              <option value="BUY">PUMP (BUY)</option>
            </select>
            <input
              type="number"
              value={whaleQty}
              onChange={(e) => setWhaleQty(Number(e.target.value) || 1000)}
              className="w-24 px-2 py-1.5 rounded bg-[#0B0E14] border border-[#232B3A] font-mono text-xs text-white"
            />
            <button
              type="button"
              onClick={fireWhale}
              className="flex-1 py-1.5 rounded bg-[#EB5B3C] text-white text-xs font-bold"
            >
              Inject
            </button>
          </div>

          <div className="pt-2 border-t border-[#232B3A] flex gap-1.5 items-center">
            <span className="text-[11px] text-[#8A94A6]">Force ₹:</span>
            <input
              type="text"
              value={overrideSymbol}
              onChange={(e) => setOverrideSymbol(e.target.value.toUpperCase())}
              className="w-20 px-2.5 py-1.5 rounded bg-[#0B0E14] border border-[#232B3A] font-mono text-xs uppercase text-white"
            />
            <input
              type="number"
              min={10}
              value={overridePrice}
              onChange={(e) => setOverridePrice(Number(e.target.value) || 10)}
              className="w-24 px-2 py-1.5 rounded bg-[#0B0E14] border border-[#232B3A] font-mono text-xs text-white"
            />
            <button
              type="button"
              onClick={fireOverride}
              className="flex-1 py-1.5 rounded bg-[#232B3A] hover:bg-[#334155] text-white text-xs font-bold"
            >
              Set Price
            </button>
          </div>
        </section>
      </div>

      {/* Live Participant Roster (With 1-Click Top-Up & Freeze) */}
      <section className="bg-[#121721] border border-[#232B3A] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#232B3A] flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-white">
            Live Participant Roster & Net Worth ({participants.length})
          </h2>
          <input
            type="text"
            placeholder="Filter reg_no or email..."
            value={rosterSearch}
            onChange={(e) => setRosterSearch(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-[#0B0E14] border border-[#232B3A] text-xs text-white w-64"
          />
        </div>
        <div className="overflow-auto scroller max-h-[340px]">
          <table className="w-full text-left border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 bg-[#121721] text-[10px] uppercase text-[#8A94A6]">
              <tr>
                <th className="py-2.5 px-4 border-b border-[#232B3A]">Rank</th>
                <th className="py-2.5 px-3 border-b border-[#232B3A]">Reg No</th>
                <th className="py-2.5 px-3 border-b border-[#232B3A]">Email</th>
                <th className="py-2.5 px-3 border-b border-[#232B3A] text-right">Cash</th>
                <th className="py-2.5 px-3 border-b border-[#232B3A] text-right">Net Worth</th>
                <th className="py-2.5 px-4 border-b border-[#232B3A] text-right">Instant Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#232B3A]/60">
              {participants.map((p: any, idx: number) => (
                <tr key={p.user_id} className="hover:bg-[#181E2B]/50">
                  <td className="py-2 px-4 font-mono text-[#8A94A6]">#{idx + 1}</td>
                  <th className="py-2 px-3 font-mono font-bold text-white">{p.registration_no}</th>
                  <td className="py-2 px-3 text-[#8A94A6]">{p.email}</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-white">
                    ₹{p.cash_balance.toLocaleString("en-IN")}
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-bold tabular-nums text-[#00D09C]">
                    ₹{p.net_worth.toLocaleString("en-IN")}
                  </td>
                  <td className="py-2 px-4 text-right space-x-1.5">
                    <button
                      type="button"
                      onClick={() => handleTopup(p.registration_no, 5000)}
                      className="px-2 py-1 rounded bg-[#00D09C]/15 hover:bg-[#00D09C]/30 text-[#00D09C] font-mono text-[11px] font-bold"
                    >
                      +₹5k
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFreezeToggle(p.registration_no, !p.is_frozen)}
                      className={`px-2 py-1 rounded text-[11px] font-bold ${
                        p.is_frozen
                          ? "bg-[#00D09C]/15 text-[#00D09C]"
                          : "bg-[#EB5B3C]/15 text-[#EB5B3C]"
                      }`}
                    >
                      {p.is_frozen ? "Unfreeze" : "Freeze"}
                    </button>
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

