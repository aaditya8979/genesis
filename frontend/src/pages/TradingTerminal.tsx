import { LogOut, Radio, ShieldCheck, Wallet } from "lucide-react";
import { CandlestickChart } from "../components/CandlestickChart";
import { ExecutionDock } from "../components/ExecutionDock";
import { HoldingsBlotter } from "../components/HoldingsBlotter";
import { WatchlistSidebar } from "../components/WatchlistSidebar";
import { useMarketSocket } from "../lib/useMarketSocket";
import { useMarketStore } from "../store/useMarketStore";

interface Props {
  onLogout: () => void;
  onGoAdmin: () => void;
}

export function TradingTerminal({ onLogout, onGoAdmin }: Props) {
  useMarketSocket(true);

  const user = useMarketStore((s) => s.user);
  const portfolio = useMarketStore((s) => s.portfolio);
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const stock = useMarketStore((s) => s.stocks[s.selectedSymbol]);
  const timeframeSec = useMarketStore((s) => s.timeframeSec);
  const setTimeframeSec = useMarketStore((s) => s.setTimeframeSec);
  const connectionMode = useMarketStore((s) => s.connectionMode);
  const activeGatewayLabel = useMarketStore((s) => s.activeGatewayLabel);
  const activeHeadline = useMarketStore((s) => s.activeHeadline);
  const activeScenarioName = useMarketStore((s) => s.activeScenarioName);
  const resetSession = useMarketStore((s) => s.resetSession);

  const netWorth = portfolio?.net_worth ?? 25000;
  const startingCapital = portfolio?.total_credited ?? 25000;
  const totalReturn = netWorth - startingCapital;
  const returnPct = startingCapital > 0 ? (totalReturn / startingCapital) * 100 : 0;
  const isUp = (stock?.change_pct ?? 0) >= 0;

  return (
    <div className="min-h-[100dvh] lg:h-[100dvh] bg-[#0B0E14] text-[#F3F5F8] flex flex-col overflow-x-hidden lg:overflow-hidden">
      {/* Top Telemetry Bar */}
      <header className="bg-[#121721] border-b border-[#232B3A] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-extrabold tracking-tight text-sm text-white">GENESIS 2026</span>
            <span className="px-2 py-0.5 rounded bg-[#181E2B] border border-[#232B3A] text-[10px] font-mono text-[#8A94A6]">
              {activeScenarioName}
            </span>
          </div>

          <div
            className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold flex items-center gap-1.5 border ${
              connectionMode === "LIVE_WSS"
                ? "bg-[#00D09C]/10 text-[#00D09C] border-[#00D09C]/30"
                : connectionMode === "POLLING_FALLBACK"
                ? "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30"
                : "bg-[#EB5B3C]/10 text-[#EB5B3C] border-[#EB5B3C]/30"
            }`}
          >
            <Radio className="w-3 h-3 animate-pulse" />
            <span>
              {connectionMode === "LIVE_WSS"
                ? `LIVE WSS (${activeGatewayLabel})`
                : connectionMode === "POLLING_FALLBACK"
                ? "HTTPS POLLING"
                : "RECONNECTING"}
            </span>
          </div>
        </div>

        {/* Live Wallet HUD */}
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <Wallet className="w-3.5 h-3.5 text-[#8A94A6]" />
            <span className="text-[#8A94A6]">Cash:</span>
            <span className="font-mono font-bold text-white tabular-nums">
              ₹{(portfolio?.cash_balance ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[#8A94A6]">Net Worth:</span>
            <span className="font-mono font-bold text-white tabular-nums">
              ₹{netWorth.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
            <span
              className={`font-mono font-semibold tabular-nums ${
                totalReturn >= 0 ? "text-[#00D09C]" : "text-[#EB5B3C]"
              }`}
            >
              ({totalReturn >= 0 ? "+" : ""}
              {returnPct.toFixed(2)}%)
            </span>
          </div>

          <div className="h-4 w-px bg-[#232B3A] hidden sm:block" />

          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#181E2B] text-[#8A94A6]">
              {user?.registration_no}
            </span>
            <button
              type="button"
              onClick={onGoAdmin}
              title="Admin Command Desk"
              className="p-1.5 rounded-md hover:bg-[#181E2B] text-[#8A94A6] hover:text-white transition-colors"
            >
              <ShieldCheck className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                resetSession();
                onLogout();
              }}
              title="Sign Out"
              className="p-1.5 rounded-md hover:bg-[#181E2B] text-[#8A94A6] hover:text-[#EB5B3C] transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Live Breaking News Ticker */}
      <div className="bg-[#181E2B] border-b border-[#232B3A] px-4 py-1.5 text-xs flex items-center gap-2.5 shrink-0">
        <span className="px-1.5 py-0.5 rounded bg-[#F59E0B]/20 text-[#F59E0B] font-mono font-bold text-[10px] shrink-0">
          FLOOR WIRE
        </span>
        <p className="text-[#F3F5F8] font-medium truncate">{activeHeadline}</p>
      </div>

      {/* Main Trading Grid */}
      <main className="flex-1 p-3 grid grid-cols-1 lg:grid-cols-[275px_1fr_320px] gap-3 min-h-0">
        {/* Left: 30 Equities Watchlist */}
        <div className="min-h-[320px] lg:min-h-0">
          <WatchlistSidebar />
        </div>

        {/* Center: Candlestick Chart + Holdings Blotter */}
        <div className="flex flex-col gap-3 min-w-0 min-h-0">
          <section className="bg-[#121721] border border-[#232B3A] rounded-xl flex-1 flex flex-col min-h-[380px] overflow-hidden">
            {/* Stock Chart Header */}
            <div className="px-4 py-2.5 border-b border-[#232B3A] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-baseline gap-3 min-w-0">
                <h2 className="font-mono font-extrabold text-base text-white">{selectedSymbol}</h2>
                <span className="text-xs text-[#8A94A6] truncate">{stock?.company_name}</span>
                <span className="font-mono font-bold text-base text-white tabular-nums">
                  ₹{(stock?.price ?? 0).toFixed(2)}
                </span>
                <span
                  className={`font-mono text-xs font-semibold tabular-nums ${
                    isUp ? "text-[#00D09C]" : "text-[#EB5B3C]"
                  }`}
                >
                  {isUp ? "+" : ""}
                  {(stock?.change_pct ?? 0).toFixed(2)}%
                </span>
                {stock?.pe_ratio !== undefined && (
                  <span className="text-[11px] font-mono text-[#8A94A6] hidden sm:inline">
                    P/E: {stock.pe_ratio > 0 ? `${stock.pe_ratio}x` : "N/A"}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1 bg-[#0B0E14] p-0.5 rounded-lg border border-[#232B3A]">
                {([5, 15, 60] as const).map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => setTimeframeSec(tf)}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono font-semibold transition-colors ${
                      timeframeSec === tf
                        ? "bg-[#232B3A] text-white"
                        : "text-[#8A94A6] hover:text-white"
                    }`}
                  >
                    {tf === 60 ? "1m" : `${tf}s`}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-h-0">
              <CandlestickChart />
            </div>
          </section>

          <HoldingsBlotter />
        </div>

        {/* Right: Execution Dock */}
        <div className="min-w-0">
          <ExecutionDock />
        </div>
      </main>
    </div>
  );
}

