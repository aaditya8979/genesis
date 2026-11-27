import { ChangeEvent, FormEvent, useMemo, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Cloud,
  Download,
  Flame,
  HardDrive,
  Lock,
  Moon,
  PauseCircle,
  PlayCircle,
  Radio,
  RefreshCw,
  Search,
  Send,
  Server,
  Sun,
  Unlock,
  Upload,
  UserPlus,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch, getActiveWsUrl } from "../lib/gateway";
import { toggleColorScheme, useResolvedTheme } from "../lib/theme";

interface Props {
  onBackTerminal: () => void;
}

type CohortTab = "REAL" | "DUMMY" | "ALL";

function csvSafeCell(v: string | number | boolean): string {
  const s = String(v ?? "");
  // Prevent CSV formula injection (=, +, -, @) in Excel / Google Sheets
  const neutralized = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

export function AdminPortal({ onBackTerminal }: Props) {
  const theme = useResolvedTheme();
  const [secretInput, setSecretInput] = useState(localStorage.getItem("genesis_admin_secret") || "");
  const [authorized, setAuthorized] = useState(Boolean(localStorage.getItem("genesis_admin_secret")));
  const [overview, setOverview] = useState<any>(null);

  // Instant Top-Up & Lookup State
  const [lookupReg, setLookupReg] = useState("");
  const [topupAmount, setTopupAmount] = useState(5000);
  const [lookedUpUser, setLookedUpUser] = useState<any>(null);

  // Cohort & Real Participant Import State
  const [cohortTab, setCohortTab] = useState<CohortTab>("REAL");
  const [showImportDrawer, setShowImportDrawer] = useState(false);
  const [singleReg, setSingleReg] = useState("");
  const [singleEmail, setSingleEmail] = useState("");
  const [singleName, setSingleName] = useState("");
  const [bulkCsvText, setBulkCsvText] = useState("");
  const [importCash, setImportCash] = useState(25000);

  // Market Controls State
  const [whaleSymbol, setWhaleSymbol] = useState("TMND");
  const [whaleSide, setWhaleSide] = useState<"BUY" | "SELL">("SELL");
  const [whaleQty, setWhaleQty] = useState(10000);
  const [overrideSymbol, setOverrideSymbol] = useState("TMND");
  const [overridePrice, setOverridePrice] = useState(180);
  const [broadcastText, setBroadcastText] = useState("");
  const [rosterSearch, setRosterSearch] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const restoreFileRef = useRef<HTMLInputElement | null>(null);

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
      toast.success("Admin Command Desk unlocked");
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
      const res = await apiFetch<any>(`/api/v1/admin/user/${encodeURIComponent(regNo.trim())}`);
      setLookedUpUser(res);
    } catch (err: any) {
      toast.error(err?.message || "Student not found");
    }
  };

  const handleFreezeToggle = async (regNo: string, freeze: boolean) => {
    try {
      await apiFetch("/api/v1/admin/user/freeze", {
        method: "POST",
        body: JSON.stringify({ registration_no: regNo, is_frozen: freeze }),
      });
      toast.success(`${regNo} ${freeze ? "FROZEN" : "RESTORED"} live`);
      fetchOverview();
    } catch (err: any) {
      toast.error(err?.message || "Action failed");
    }
  };

  const handleCohortSwitch = async (regNo: string, nextCohort: "REAL" | "DUMMY") => {
    try {
      await apiFetch("/api/v1/admin/user/cohort", {
        method: "PATCH",
        body: JSON.stringify({ registration_no: regNo, cohort: nextCohort }),
      });
      toast.success(`Moved ${regNo} -> ${nextCohort} cohort`);
      fetchOverview();
    } catch (err: any) {
      toast.error(err?.message || "Cohort switch failed");
    }
  };

  const handleSingleRealAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!singleReg.trim() || !singleEmail.trim()) return;
    try {
      const res = await apiFetch<any>("/api/v1/admin/users/import-real", {
        method: "POST",
        body: JSON.stringify({
          participants: [
            {
              registration_no: singleReg.trim().toUpperCase(),
              email: singleEmail.trim().toLowerCase(),
              full_name: singleName.trim() || singleReg.trim().toUpperCase(),
            },
          ],
          starting_cash: importCash,
        }),
      });
      toast.success(`Saved REAL participant (${res.created} added, ${res.updated} updated)`);
      setSingleReg("");
      setSingleEmail("");
      setSingleName("");
      setCohortTab("REAL");
      fetchOverview();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save real student");
    }
  };

  const handleBulkCsvImport = async () => {
    const lines = bulkCsvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const items: Array<{ registration_no: string; email: string; full_name: string }> = [];

    for (const line of lines) {
      const parts = line.split(/[,\t;]+/).map((p) => p.trim());
      if (parts.length < 2) continue;
      // Support either "REG,EMAIL,NAME" or "EMAIL,REG,NAME"
      const isFirstEmail = parts[0].includes("@");
      const email = isFirstEmail ? parts[0] : parts[1];
      const regNo = isFirstEmail ? parts[1] : parts[0];
      const fullName = parts[2] || regNo;
      if (!email.includes("@") || regNo.length < 3) continue;
      items.push({ registration_no: regNo.toUpperCase(), email: email.toLowerCase(), full_name: fullName });
    }

    if (items.length === 0) {
      toast.error("Provide lines formatted as: REG_NO, email@vitbhopal.ac.in, Full Name");
      return;
    }

    try {
      const res = await apiFetch<any>("/api/v1/admin/users/import-real", {
        method: "POST",
        body: JSON.stringify({ participants: items, starting_cash: importCash }),
      });
      toast.success(`Real cohort imported: ${res.created} created, ${res.updated} updated`);
      setBulkCsvText("");
      setCohortTab("REAL");
      fetchOverview();
    } catch (err: any) {
      toast.error(err?.message || "Bulk import failed");
    }
  };

  const exportTallyCsv = async () => {
    try {
      const tally = await apiFetch<any>("/api/v1/admin/tally");
      const rows = cohortTab === "DUMMY" ? tally.dummy_tally : tally.real_tally;
      const header = [
        "Rank",
        "Cohort",
        "RegNo",
        "FullName",
        "Email",
        "CashBalance",
        "HoldingsValue",
        "CollateralLocked",
        "ShortLiability",
        "UnrealizedPnL",
        "TotalCredited",
        "NetWorth",
        "NetReturnPct",
        "PositionsCount",
        "Frozen",
      ];
      const lines = [
        header.join(","),
        ...rows.map((r: any, idx: number) =>
          [
            idx + 1,
            r.cohort,
            r.registration_no,
            r.full_name || r.registration_no,
            r.email,
            r.cash_balance.toFixed(2),
            (r.holdings_value ?? 0).toFixed(2),
            r.collateral_locked.toFixed(2),
            (r.short_liability ?? 0).toFixed(2),
            (r.unrealized_pnl ?? 0).toFixed(2),
            r.total_credited.toFixed(2),
            r.net_worth.toFixed(2),
            (r.net_return_pct ?? 0).toFixed(2),
            r.positions_count,
            r.is_frozen ? "YES" : "NO",
          ]
            .map(csvSafeCell)
            .join(",")
        ),
      ];
      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `genesis-2026-${cohortTab === "DUMMY" ? "dummy" : "real"}-tally.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${rows.length} ${cohortTab === "DUMMY" ? "Dummy" : "Real"} user rows`);
    } catch (err: any) {
      toast.error(err?.message || "Tally export failed");
    }
  };

  const triggerManualBackup = async () => {
    setBackupBusy(true);
    try {
      const res = await apiFetch<any>("/api/v1/system/backup/now", { method: "POST" });
      toast.success(
        `Snapshot seq #${res.backup.seq} saved locally${res.backup.supabase_synced ? " + Supabase" : ""}${
          res.backup.standby_synced ? " + Standby" : ""
        }`
      );
      fetchOverview();
    } catch (err: any) {
      toast.error(err?.message || "Manual backup failed");
    } finally {
      setBackupBusy(false);
    }
  };

  const downloadSnapshotJson = async () => {
    setBackupBusy(true);
    try {
      const snap = await apiFetch<any>("/api/v1/system/snapshot");
      const blob = new Blob([JSON.stringify(snap)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `genesis_backup_seq_${snap.seq || 0}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded portable snapshot (${(blob.size / 1024).toFixed(0)} KB)`);
    } catch (err: any) {
      toast.error(err?.message || "Snapshot download failed");
    } finally {
      setBackupBusy(false);
    }
  };

  const restoreFromSupabase = async () => {
    setBackupBusy(true);
    try {
      const res = await apiFetch<any>("/api/v1/system/backup/restore-supabase", { method: "POST" });
      toast.success(`Restored ${res.restored_users} users (seq #${res.seq}) from Supabase Vault!`);
      fetchOverview();
    } catch (err: any) {
      toast.error(err?.message || "Supabase restore failed");
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestoreFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBackupBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await apiFetch<any>("/api/v1/system/restore", {
        method: "POST",
        body: JSON.stringify(parsed),
      });
      toast.success(`Restored ${res.restored_users} users & ${res.restored_holdings} holdings (seq #${res.seq})`);
      fetchOverview();
    } catch (err: any) {
      toast.error(err?.message || "Invalid or failed snapshot file restore");
    } finally {
      setBackupBusy(false);
    }
  };

  const triggerEra = async (eraId: string) => {
    try {
      const res = await apiFetch<any>("/api/v1/admin/scenario/trigger", {
        method: "POST",
        body: JSON.stringify({ era_id: eraId }),
      });
      toast.success(`Triggered: ${res.era} (Liquidations: ${res.liquidations_triggered})`);
      fetchOverview();
    } catch (err: any) {
      toast.error(err?.message || "Era trigger failed");
    }
  };

  const fireWhale = async () => {
    try {
      const res = await apiFetch<any>("/api/v1/admin/whale", {
        method: "POST",
        body: JSON.stringify({ symbol: whaleSymbol, side: whaleSide, quantity: whaleQty }),
      });
      toast.success(`Whale ${whaleSide} ${whaleQty} ${whaleSymbol}: ₹${res.before} -> ₹${res.after}`);
    } catch (err: any) {
      toast.error(err?.message || "Whale injection failed");
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
      toast.error(err?.message || "Price override failed");
    }
  };

  const toggleMarket = async () => {
    const next = !(overview?.is_market_open ?? true);
    await apiFetch("/api/v1/admin/market/pause", {
      method: "PATCH",
      body: JSON.stringify({ is_market_open: next }),
    });
    fetchOverview();
  };

  const toggleTicks = async () => {
    const next = !(overview?.ticks_enabled ?? true);
    await apiFetch("/api/v1/admin/ticks/toggle", {
      method: "PATCH",
      body: JSON.stringify({ ticks_enabled: next }),
    });
    fetchOverview();
  };

  const setRegime = async (regime: "CALM" | "DYNAMIC" | "FRENZY") => {
    await apiFetch("/api/v1/admin/volatility", {
      method: "PATCH",
      body: JSON.stringify({ regime, simulate_flow: true }),
    });
    toast.success(`Volatility Regime set to ${regime}`);
    fetchOverview();
  };

  const sendBroadcast = async (e: FormEvent) => {
    e.preventDefault();
    if (!broadcastText.trim()) return;
    await apiFetch("/api/v1/admin/broadcast", {
      method: "POST",
      body: JSON.stringify({ headline: broadcastText.trim() }),
    });
    toast.success("Headline pushed to Floor Wire");
    setBroadcastText("");
    fetchOverview();
  };

  const resetMarketToBase = async () => {
    try {
      const res = await apiFetch<any>("/api/v1/admin/market/reset-prices", { method: "POST" });
      toast.success(`Reset all ${res.stocks_reset} stocks to Round 0 Base levels`);
      fetchOverview();
    } catch (err: any) {
      toast.error(err?.message || "Market reset failed");
    }
  };

  const allParticipants = overview?.participants || [];
  const realParticipants = useMemo(
    () => allParticipants.filter((p: any) => (p.cohort || "REAL") === "REAL"),
    [allParticipants]
  );
  const dummyParticipants = useMemo(
    () => allParticipants.filter((p: any) => p.cohort === "DUMMY"),
    [allParticipants]
  );

  const visibleRoster = useMemo(() => {
    const base =
      cohortTab === "REAL"
        ? realParticipants
        : cohortTab === "DUMMY"
        ? dummyParticipants
        : allParticipants;
    const q = rosterSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (p: any) =>
        p.registration_no.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        (p.full_name || "").toLowerCase().includes(q)
    );
  }, [cohortTab, realParticipants, dummyParticipants, allParticipants, rosterSearch]);

  if (!authorized) {
    return (
      <div className="min-h-[100dvh] bg-[var(--tv-bg)] text-[var(--tv-text)] flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-[var(--tv-surface)] border border-[var(--tv-border)] rounded-2xl p-6 space-y-4 shadow-2xl">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-base font-bold text-[var(--tv-text)]">Admin Command Desk</h1>
              <p className="text-xs text-[var(--tv-muted)] mt-0.5">
                Enter organizer master key to manage cohorts &amp; live regimes.
              </p>
            </div>
            <button
              type="button"
              onClick={() => toggleColorScheme()}
              aria-label="Toggle color theme"
              className="p-1.5 rounded-lg border border-[var(--tv-border)] hover:bg-[var(--tv-hover)] text-[var(--tv-muted)] hover:text-[var(--tv-text)]"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
          <form onSubmit={handleAdminAuth} className="space-y-3">
            <input
              type="password"
              required
              placeholder="Admin Secret Key"
              value={secretInput}
              onChange={(e) => setSecretInput(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--tv-bg)] border border-[var(--tv-border)] text-sm font-mono text-[var(--tv-text)] focus:outline-none focus:border-[#2962FF]"
            />
            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-[#2962FF] hover:bg-[#1E53E5] text-white font-semibold text-sm transition-colors"
            >
              Unlock Command Desk
            </button>
          </form>
          <button
            type="button"
            onClick={onBackTerminal}
            className="text-xs text-[var(--tv-muted)] hover:text-[var(--tv-text)] flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Supercharts Terminal
          </button>
        </div>
      </div>
    );
  }

  const cs = overview?.cohort_summary;

  return (
    <div className="min-h-[100dvh] bg-[var(--tv-bg)] text-[var(--tv-text)] flex flex-col">
      {/* TradingView-style 44px Admin Toolbar */}
      <header className="h-11 bg-[var(--tv-bg)] border-b border-[var(--tv-border)] px-3 flex items-center justify-between gap-2 shrink-0 overflow-x-auto scroller">
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onBackTerminal}
            className="px-2.5 py-1 rounded bg-[var(--tv-surface)] border border-[var(--tv-border)] hover:bg-[var(--tv-hover)] text-xs font-medium flex items-center gap-1 text-[var(--tv-text)] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Floor
          </button>
          <span className="font-bold text-xs tracking-wider text-[var(--tv-text)]">
            GENESIS 2026 · ADMIN COMMAND
          </span>
          <span className="hidden md:inline text-[11px] font-mono px-2 py-0.5 rounded bg-[var(--tv-surface)] border border-[var(--tv-border)] text-[var(--tv-muted)]">
            {overview?.active_scenario_name || "Loading..."}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center bg-[var(--tv-surface)] border border-[var(--tv-border)] rounded p-0.5 text-[10px] font-mono">
            {(["CALM", "DYNAMIC", "FRENZY"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRegime(r)}
                className={`px-2 py-0.5 rounded font-semibold transition-colors ${
                  overview?.volatility_regime === r
                    ? "bg-[#2962FF] text-white"
                    : "text-[var(--tv-muted)] hover:text-[var(--tv-text)]"
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={toggleMarket}
            className={`px-2.5 py-1 rounded text-xs font-semibold border flex items-center gap-1 transition-colors ${
              overview?.is_market_open
                ? "bg-[#F23645]/10 text-[#F23645] border-[#F23645]/30 hover:bg-[#F23645]/20"
                : "bg-[#089981]/10 text-[#089981] border-[#089981]/30 hover:bg-[#089981]/20"
            }`}
          >
            {overview?.is_market_open ? (
              <>
                <PauseCircle className="w-3.5 h-3.5" /> PAUSE
              </>
            ) : (
              <>
                <PlayCircle className="w-3.5 h-3.5" /> RESUME
              </>
            )}
          </button>

          <button
            type="button"
            onClick={resetMarketToBase}
            title="Reset all 30 stock prices & candles back to Round 0 Base levels (keeps students & wallets)"
            className="px-2.5 py-1 rounded text-xs font-semibold border border-[var(--tv-border)] bg-[var(--tv-surface)] hover:bg-[var(--tv-hover)] text-[var(--tv-text)] transition-colors"
          >
            Reset Base
          </button>

          <button
            type="button"
            onClick={toggleTicks}
            className="px-2.5 py-1 rounded bg-[var(--tv-surface)] border border-[var(--tv-border)] text-xs font-mono font-medium text-[var(--tv-text)] hover:bg-[var(--tv-hover)] transition-colors"
          >
            Ticks: {overview?.ticks_enabled ? "ON" : "OFF"}
          </button>

          <button
            type="button"
            onClick={() => toggleColorScheme()}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="p-1.5 rounded hover:bg-[var(--tv-hover)] text-[var(--tv-muted)] hover:text-[var(--tv-text)] transition-colors"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      <div className="p-3 space-y-3 flex-1 min-w-0">
        {/* Hairline Telemetry & Cohort Summary Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-5 border border-[var(--tv-border)] bg-[var(--tv-surface)] divide-y lg:divide-y-0 lg:divide-x divide-[var(--tv-border)] rounded-lg overflow-hidden">
          <div className="p-3">
            <div className="text-[11px] text-[var(--tv-muted)] flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-[#089981]" /> Concurrent Sockets
            </div>
            <div className="text-xl font-mono font-bold text-[var(--tv-text)] mt-1 tabular-nums">
              {overview?.active_sockets ?? 0}
            </div>
            <div className="text-[10px] text-[var(--tv-muted)] font-mono">
              Evicted slow: {overview?.evicted_slow_clients ?? 0} · {overview?.orders_per_sec ?? 0} ord/s
            </div>
          </div>

          <div className="p-3">
            <div className="text-[11px] text-[#089981] font-semibold flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Real Event Cohort
            </div>
            <div className="text-xl font-mono font-bold text-[var(--tv-text)] mt-1 tabular-nums">
              {cs?.real_count ?? realParticipants.length}
            </div>
            <div className="text-[10px] text-[var(--tv-muted)] font-mono tabular-nums">
              Pool: ₹{(cs?.real_net_worth_pool ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
          </div>

          <div className="p-3">
            <div className="text-[11px] text-[var(--tv-muted)] flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-[#2962FF]" /> Dummy Sim Cohort
            </div>
            <div className="text-xl font-mono font-bold text-[var(--tv-text)] mt-1 tabular-nums">
              {cs?.dummy_count ?? dummyParticipants.length}
            </div>
            <div className="text-[10px] text-[var(--tv-muted)] font-mono tabular-nums">
              Sim Pool: ₹{(cs?.dummy_net_worth_pool ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
          </div>

          <div className="p-3">
            <div className="text-[11px] text-[var(--tv-muted)] flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-[#089981]" /> Total Cash &amp; Escrow
            </div>
            <div className="text-xl font-mono font-bold text-[var(--tv-text)] mt-1 tabular-nums">
              ₹{(overview?.total_cash_circulation ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
            <div className="text-[10px] text-[var(--tv-muted)] font-mono">
              Authoritative DB ({overview?.registered_count ?? 0} total)
            </div>
          </div>

          <div className="p-3 col-span-2 lg:col-span-1">
            <div className="text-[11px] text-[var(--tv-muted)] flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-[#F23645]" /> Floor Wire Broadcast
            </div>
            <form onSubmit={sendBroadcast} className="flex gap-1.5 mt-1.5">
              <input
                type="text"
                placeholder="Push alert banner..."
                value={broadcastText}
                onChange={(e) => setBroadcastText(e.target.value)}
                className="flex-1 min-w-0 px-2.5 py-1 rounded bg-[var(--tv-bg)] border border-[var(--tv-border)] text-xs text-[var(--tv-text)] focus:outline-none focus:border-[#2962FF]"
              />
              <button
                type="submit"
                aria-label="Send headline broadcast"
                className="px-2.5 py-1 rounded bg-[#2962FF] hover:bg-[#1E53E5] text-white font-semibold transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>

        {/* Main Controls Row: Top-Up Desk + Era Triggers + Whale/Override */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <section className="bg-[var(--tv-surface)] border border-[var(--tv-border)] rounded-lg p-3.5 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#089981]">
              Live Wallet Top-Up &amp; Lookup
            </h2>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Reg No (e.g. 25BCE10421)"
                value={lookupReg}
                onChange={(e) => setLookupReg(e.target.value.toUpperCase())}
                className="flex-1 px-2.5 py-1.5 rounded bg-[var(--tv-bg)] border border-[var(--tv-border)] font-mono text-xs uppercase text-[var(--tv-text)] focus:outline-none focus:border-[#2962FF]"
              />
              <button
                type="button"
                onClick={() => handleLookup(lookupReg)}
                className="px-3 py-1.5 rounded bg-[var(--tv-bg)] border border-[var(--tv-border)] hover:bg-[var(--tv-hover)] text-xs font-medium text-[var(--tv-text)] flex items-center gap-1 transition-colors"
              >
                <Search className="w-3.5 h-3.5" /> Inspect
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={topupAmount}
                onChange={(e) => setTopupAmount(Number(e.target.value) || 0)}
                className="w-24 px-2.5 py-1.5 rounded bg-[var(--tv-bg)] border border-[var(--tv-border)] font-mono text-xs text-[var(--tv-text)] focus:outline-none focus:border-[#2962FF]"
              />
              {[5000, 10000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleTopup(lookupReg, preset)}
                  className="px-2 py-1.5 rounded bg-[#089981]/10 hover:bg-[#089981]/20 border border-[#089981]/30 text-[#089981] font-mono text-xs font-semibold"
                >
                  +₹{preset / 1000}k
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleTopup(lookupReg, topupAmount)}
                className="flex-1 py-1.5 rounded bg-[#089981] hover:bg-[#067A67] text-white text-xs font-semibold transition-colors"
              >
                Credit Live
              </button>
            </div>

            {lookedUpUser && (
              <div className="p-2.5 rounded bg-[var(--tv-bg)] border border-[var(--tv-border)] text-xs space-y-1">
                <div className="flex justify-between font-mono items-center">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-[var(--tv-text)]">{lookedUpUser.user.registration_no}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        lookedUpUser.user.cohort === "DUMMY"
                          ? "bg-[var(--tv-hover)] text-[var(--tv-muted)]"
                          : "bg-[#2962FF]/15 text-[#2962FF]"
                      }`}
                    >
                      {lookedUpUser.user.cohort || "REAL"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleFreezeToggle(lookedUpUser.user.registration_no, !lookedUpUser.user.is_frozen)}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 ${
                      lookedUpUser.user.is_frozen
                        ? "bg-[#089981]/15 text-[#089981]"
                        : "bg-[#F23645]/15 text-[#F23645]"
                    }`}
                  >
                    {lookedUpUser.user.is_frozen ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                    {lookedUpUser.user.is_frozen ? "UNFREEZE" : "FREEZE"}
                  </button>
                </div>
                <div className="text-[var(--tv-muted)] truncate">{lookedUpUser.user.email}</div>
                <div className="flex justify-between pt-1 font-mono tabular-nums">
                  <span>Cash: ₹{lookedUpUser.portfolio.cash_balance.toLocaleString("en-IN")}</span>
                  <span className="text-[#089981]">
                    Net: ₹{lookedUpUser.portfolio.net_worth.toLocaleString("en-IN")}
                  </span>
                </div>
              </div>
            )}
          </section>

          <section className="bg-[var(--tv-surface)] border border-[var(--tv-border)] rounded-lg p-3.5 space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#2962FF] flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" /> Macro Era Shock Triggers
            </h2>
            <div className="grid grid-cols-2 gap-1.5 max-h-[210px] overflow-y-auto scroller pr-1">
              {(overview?.eras || []).map((era: any) => {
                const isActive = overview?.active_era_id === era.id;
                return (
                  <button
                    key={era.id}
                    type="button"
                    onClick={() => triggerEra(era.id)}
                    className={`p-2 rounded text-left border text-[11px] transition-colors ${
                      isActive
                        ? "bg-[#2962FF]/15 border-[#2962FF] text-[var(--tv-text)]"
                        : era.severity === "CRASH"
                        ? "bg-[#F23645]/10 hover:bg-[#F23645]/20 border-[#F23645]/30 text-[var(--tv-text)]"
                        : "bg-[#089981]/10 hover:bg-[#089981]/20 border-[#089981]/30 text-[var(--tv-text)]"
                    }`}
                  >
                    <div className="font-semibold truncate">{era.name}</div>
                    <div className="text-[9px] font-mono opacity-75">{era.severity}</div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="bg-[var(--tv-surface)] border border-[var(--tv-border)] rounded-lg p-3.5 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#F23645]">
              Whale Injection &amp; Price Override
            </h2>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={whaleSymbol}
                onChange={(e) => setWhaleSymbol(e.target.value.toUpperCase())}
                className="w-16 px-2 py-1.5 rounded bg-[var(--tv-bg)] border border-[var(--tv-border)] font-mono text-xs uppercase text-[var(--tv-text)]"
              />
              <select
                value={whaleSide}
                onChange={(e) => setWhaleSide(e.target.value as "BUY" | "SELL")}
                className="px-2 py-1.5 rounded bg-[var(--tv-bg)] border border-[var(--tv-border)] font-mono text-xs text-[var(--tv-text)]"
              >
                <option value="SELL">DUMP (SELL)</option>
                <option value="BUY">PUMP (BUY)</option>
              </select>
              <input
                type="number"
                value={whaleQty}
                onChange={(e) => setWhaleQty(Number(e.target.value) || 1000)}
                className="w-20 px-2 py-1.5 rounded bg-[var(--tv-bg)] border border-[var(--tv-border)] font-mono text-xs text-[var(--tv-text)]"
              />
              <button
                type="button"
                onClick={fireWhale}
                className="flex-1 py-1.5 rounded bg-[#F23645] hover:bg-[#D62839] text-white text-xs font-semibold transition-colors"
              >
                Inject
              </button>
            </div>

            <div className="pt-2.5 border-t border-[var(--tv-border)] flex gap-1.5 items-center">
              <span className="text-[11px] text-[var(--tv-muted)]">Force ₹:</span>
              <input
                type="text"
                value={overrideSymbol}
                onChange={(e) => setOverrideSymbol(e.target.value.toUpperCase())}
                className="w-16 px-2 py-1.5 rounded bg-[var(--tv-bg)] border border-[var(--tv-border)] font-mono text-xs uppercase text-[var(--tv-text)]"
              />
              <input
                type="number"
                min={10}
                value={overridePrice}
                onChange={(e) => setOverridePrice(Number(e.target.value) || 10)}
                className="w-20 px-2 py-1.5 rounded bg-[var(--tv-bg)] border border-[var(--tv-border)] font-mono text-xs text-[var(--tv-text)]"
              />
              <button
                type="button"
                onClick={fireOverride}
                className="flex-1 py-1.5 rounded bg-[var(--tv-bg)] border border-[var(--tv-border)] hover:bg-[var(--tv-hover)] text-[var(--tv-text)] text-xs font-semibold transition-colors"
              >
                Set Price
              </button>
            </div>
          </section>
        </div>

        {/* Multi-Tier Backup & Disaster Recovery Vault */}
        <section className="bg-[var(--tv-surface)] border border-[var(--tv-border)] rounded-lg p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#2962FF]">
                3-Tier Backup &amp; Failover Vault (5s Cadence)
              </h2>
              <p className="text-[11px] text-[var(--tv-muted)]">
                Auto-mirrors ledger, transactions &amp; candles to Local Disk, Warm Standby, and Supabase without blocking orders.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={backupBusy}
                onClick={triggerManualBackup}
                className="px-2.5 py-1.5 rounded bg-[#2962FF] hover:bg-[#1E53E5] disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${backupBusy ? "animate-spin" : ""}`} />
                Backup Now
              </button>
              <button
                type="button"
                disabled={backupBusy}
                onClick={downloadSnapshotJson}
                className="px-2.5 py-1.5 rounded bg-[var(--tv-bg)] border border-[var(--tv-border)] hover:bg-[var(--tv-hover)] text-xs font-medium text-[var(--tv-text)] flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download .json
              </button>
              <input
                ref={restoreFileRef}
                type="file"
                accept="application/json,.json"
                onChange={handleRestoreFileChange}
                className="hidden"
              />
              <button
                type="button"
                disabled={backupBusy}
                onClick={() => restoreFileRef.current?.click()}
                className="px-2.5 py-1.5 rounded bg-[var(--tv-bg)] border border-[var(--tv-border)] hover:bg-[var(--tv-hover)] text-xs font-medium text-[var(--tv-text)] flex items-center gap-1.5 transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                Restore .json
              </button>
              <button
                type="button"
                disabled={backupBusy}
                onClick={restoreFromSupabase}
                className="px-2.5 py-1.5 rounded bg-[#089981]/15 hover:bg-[#089981]/25 border border-[#089981]/30 text-[#089981] text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Cloud className="w-3.5 h-3.5" />
                Pull from Supabase
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs font-mono">
            <div className="p-2.5 rounded bg-[var(--tv-bg)] border border-[var(--tv-border)] flex items-start gap-2">
              <HardDrive className="w-4 h-4 text-[#089981] shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="font-semibold text-[var(--tv-text)]">Tier 1 · Local Disk Vault</div>
                <div className="text-[11px] text-[var(--tv-muted)]">
                  seq #{overview?.backup_status?.local_latest_seq ?? 0} ·{" "}
                  {overview?.backup_status?.local_history_count ?? 0} checkpoints
                </div>
              </div>
            </div>
            <div className="p-2.5 rounded bg-[var(--tv-bg)] border border-[var(--tv-border)] flex items-start gap-2">
              <Server className="w-4 h-4 text-[#2962FF] shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="font-semibold text-[var(--tv-text)]">
                  Tier 2 · Standby: {overview?.backup_status?.standby_last_status ?? "DISABLED"}
                </div>
                <div className="text-[11px] text-[var(--tv-muted)] truncate">
                  {overview?.backup_status?.standby_push_url ||
                    overview?.backup_status?.primary_pull_url ||
                    "Set STANDBY_SYNC_URL or PRIMARY_SYNC_URL"}
                </div>
              </div>
            </div>
            <div className="p-2.5 rounded bg-[var(--tv-bg)] border border-[var(--tv-border)] flex items-start gap-2">
              <Cloud className="w-4 h-4 text-[#089981] shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="font-semibold text-[var(--tv-text)]">
                  Tier 3 · Supabase: {overview?.backup_status?.supabase_last_status ?? "DISABLED"}
                </div>
                <div className="text-[11px] text-[var(--tv-muted)] truncate">
                  {overview?.backup_status?.supabase_mode === "DISABLED"
                    ? "Set SUPABASE_DB_URL or SUPABASE_URL"
                    : `${overview?.backup_status?.supabase_mode} · seq #${overview?.backup_status?.supabase_last_seq ?? 0}`}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Separated Real Cohort Roster vs Dummy Simulation Bots + Tally Controls */}
        <section className="bg-[var(--tv-surface)] border border-[var(--tv-border)] rounded-lg overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-[var(--tv-border)] flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="tablist"
                aria-label="Participant cohorts"
                className="flex items-center bg-[var(--tv-bg)] border border-[var(--tv-border)] rounded p-0.5 text-[11px] font-semibold"
              >
                <button
                  type="button"
                  onClick={() => setCohortTab("REAL")}
                  className={`px-2.5 py-1 rounded transition-colors ${
                    cohortTab === "REAL"
                      ? "bg-[#2962FF] text-white"
                      : "text-[var(--tv-muted)] hover:text-[var(--tv-text)]"
                  }`}
                >
                  Real Participants ({realParticipants.length})
                </button>
                <button
                  type="button"
                  onClick={() => setCohortTab("DUMMY")}
                  className={`px-2.5 py-1 rounded transition-colors ${
                    cohortTab === "DUMMY"
                      ? "bg-[#2962FF] text-white"
                      : "text-[var(--tv-muted)] hover:text-[var(--tv-text)]"
                  }`}
                >
                  Dummy Bots ({dummyParticipants.length})
                </button>
                <button
                  type="button"
                  onClick={() => setCohortTab("ALL")}
                  className={`px-2.5 py-1 rounded transition-colors ${
                    cohortTab === "ALL"
                      ? "bg-[#2962FF] text-white"
                      : "text-[var(--tv-muted)] hover:text-[var(--tv-text)]"
                  }`}
                >
                  All ({allParticipants.length})
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowImportDrawer((v) => !v)}
                className="px-2.5 py-1 rounded bg-[#089981]/10 hover:bg-[#089981]/20 border border-[#089981]/30 text-[#089981] text-[11px] font-semibold flex items-center gap-1"
              >
                <UserPlus className="w-3.5 h-3.5" /> Add Real Student / CSV
              </button>

              <button
                type="button"
                onClick={exportTallyCsv}
                className="px-2.5 py-1 rounded bg-[var(--tv-bg)] hover:bg-[var(--tv-hover)] border border-[var(--tv-border)] text-[var(--tv-text)] text-[11px] font-semibold flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" /> Export {cohortTab === "DUMMY" ? "Dummy" : "Real"} Tally CSV
              </button>
            </div>

            <input
              type="text"
              placeholder="Search reg_no, name, or email..."
              value={rosterSearch}
              onChange={(e) => setRosterSearch(e.target.value)}
              className="px-2.5 py-1 rounded bg-[var(--tv-bg)] border border-[var(--tv-border)] text-xs text-[var(--tv-text)] w-64 focus:outline-none focus:border-[#2962FF]"
            />
          </div>

          {/* Collapsible Real Participant Registration & Bulk CSV Importer */}
          {showImportDrawer && (
            <div className="p-3.5 border-b border-[var(--tv-border)] bg-[var(--tv-bg)] grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
              <form onSubmit={handleSingleRealAdd} className="space-y-2">
                <div className="font-semibold text-[#089981] uppercase tracking-wider text-[11px]">
                  Save Single Real Participant (Isolated REAL Cohort)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    required
                    placeholder="Reg No (e.g. 25BCE10421)"
                    value={singleReg}
                    onChange={(e) => setSingleReg(e.target.value.toUpperCase())}
                    className="px-2.5 py-1.5 rounded bg-[var(--tv-surface)] border border-[var(--tv-border)] font-mono uppercase text-[var(--tv-text)]"
                  />
                  <input
                    type="email"
                    required
                    placeholder="student@vitbhopal.ac.in"
                    value={singleEmail}
                    onChange={(e) => setSingleEmail(e.target.value)}
                    className="px-2.5 py-1.5 rounded bg-[var(--tv-surface)] border border-[var(--tv-border)] text-[var(--tv-text)]"
                  />
                  <input
                    type="text"
                    placeholder="Full Name"
                    value={singleName}
                    onChange={(e) => setSingleName(e.target.value)}
                    className="px-2.5 py-1.5 rounded bg-[var(--tv-surface)] border border-[var(--tv-border)] text-[var(--tv-text)]"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-[var(--tv-muted)] font-mono">
                    Starting ₹:
                  </label>
                  <input
                    type="number"
                    min={100}
                    value={importCash}
                    onChange={(e) => setImportCash(Number(e.target.value) || 25000)}
                    className="w-24 px-2 py-1 rounded bg-[var(--tv-surface)] border border-[var(--tv-border)] font-mono text-[var(--tv-text)]"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1 rounded bg-[#2962FF] hover:bg-[#1E53E5] text-white font-semibold"
                  >
                    Save Real User
                  </button>
                </div>
              </form>

              <div className="space-y-2">
                <div className="font-semibold text-[#2962FF] uppercase tracking-wider text-[11px]">
                  Bulk Import Real Participants (CSV: REG_NO, EMAIL, FULL_NAME)
                </div>
                <textarea
                  rows={2}
                  placeholder={"25BCE10001, student1@vitbhopal.ac.in, Aarav Patel\n25BAI10002, student2@vitbhopal.ac.in, Diya Nair"}
                  value={bulkCsvText}
                  onChange={(e) => setBulkCsvText(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded bg-[var(--tv-surface)] border border-[var(--tv-border)] font-mono text-[11px] text-[var(--tv-text)]"
                />
                <button
                  type="button"
                  onClick={handleBulkCsvImport}
                  className="px-3 py-1 rounded bg-[#089981] hover:bg-[#067A67] text-white font-semibold"
                >
                  Import Bulk Real Roster
                </button>
              </div>
            </div>
          )}

          <div tabIndex={0} role="region" aria-label="Participant roster" className="overflow-auto scroller max-h-[360px]">
            <table className="w-full text-left border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 z-10 bg-[var(--tv-surface)] text-[10px] uppercase text-[var(--tv-muted)]">
                <tr>
                  <th className="py-2 px-3.5 border-b border-[var(--tv-border)]">Rank</th>
                  <th className="py-2 px-2.5 border-b border-[var(--tv-border)]">Cohort</th>
                  <th className="py-2 px-3 border-b border-[var(--tv-border)]">Reg No</th>
                  <th className="py-2 px-3 border-b border-[var(--tv-border)]">Participant &amp; Email</th>
                  <th className="py-2 px-3 border-b border-[var(--tv-border)] text-right">Cash</th>
                  <th className="py-2 px-3 border-b border-[var(--tv-border)] text-right">Net Worth</th>
                  <th className="py-2 px-3 border-b border-[var(--tv-border)] text-right">Return</th>
                  <th className="py-2 px-3.5 border-b border-[var(--tv-border)] text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--tv-border)]/50">
                {visibleRoster.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-xs text-[var(--tv-muted)]">
                      No participants in this cohort view yet. Click &ldquo;Add Real Student / CSV&rdquo; or have students sign in.
                    </td>
                  </tr>
                ) : (
                  visibleRoster.map((p: any, idx: number) => {
                    const cohort = p.cohort || "REAL";
                    const retPct = p.net_return_pct ?? 0;
                    return (
                      <tr key={p.user_id} className="hover:bg-[var(--tv-hover)]/60">
                        <td className="py-2 px-3.5 font-mono text-[var(--tv-muted)]">#{idx + 1}</td>
                        <td className="py-2 px-2.5">
                          <span
                            className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-bold ${
                              cohort === "REAL"
                                ? "bg-[#089981]/15 text-[#089981]"
                                : "bg-[var(--tv-bg)] border border-[var(--tv-border)] text-[var(--tv-muted)]"
                            }`}
                          >
                            {cohort}
                          </span>
                        </td>
                        <th className="py-2 px-3 font-mono font-bold text-[var(--tv-text)]">
                          {p.registration_no}
                        </th>
                        <td className="py-2 px-3">
                          <div className="font-medium text-[var(--tv-text)]">
                            {p.full_name || p.registration_no}
                          </div>
                          <div className="text-[11px] text-[var(--tv-muted)]">{p.email}</div>
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-[var(--tv-text)]">
                          ₹{p.cash_balance.toLocaleString("en-IN")}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold tabular-nums text-[#089981]">
                          ₹{p.net_worth.toLocaleString("en-IN")}
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-mono font-semibold tabular-nums ${
                            retPct >= 0 ? "text-[#089981]" : "text-[#F23645]"
                          }`}
                        >
                          {retPct >= 0 ? "+" : ""}
                          {retPct.toFixed(2)}%
                        </td>
                        <td className="py-2 px-3.5 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleTopup(p.registration_no, 5000)}
                            className="px-2 py-0.5 rounded bg-[#089981]/15 hover:bg-[#089981]/25 text-[#089981] font-mono text-[11px] font-semibold"
                          >
                            +₹5k
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleCohortSwitch(p.registration_no, cohort === "REAL" ? "DUMMY" : "REAL")
                            }
                            title={cohort === "REAL" ? "Move to Dummy cohort" : "Promote to Real cohort"}
                            className="px-2 py-0.5 rounded bg-[var(--tv-bg)] border border-[var(--tv-border)] hover:bg-[var(--tv-hover)] text-[var(--tv-muted)] hover:text-[var(--tv-text)] font-mono text-[10px]"
                          >
                            {cohort === "REAL" ? "→ Dummy" : "→ Real"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleFreezeToggle(p.registration_no, !p.is_frozen)}
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                              p.is_frozen
                                ? "bg-[#089981]/15 text-[#089981]"
                                : "bg-[#F23645]/15 text-[#F23645]"
                            }`}
                          >
                            {p.is_frozen ? "Unfreeze" : "Freeze"}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
