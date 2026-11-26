import {
  Crosshair,
  Flag,
  LogOut,
  Magnet,
  Maximize2,
  Minus,
  Moon,
  Radio,
  ShieldCheck,
  Sun,
  Wallet,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { CandlestickChart } from "../components/CandlestickChart";
import { ExecutionDock } from "../components/ExecutionDock";
import { HoldingsBlotter } from "../components/HoldingsBlotter";
import { WatchlistSidebar } from "../components/WatchlistSidebar";
import { getSymbolBadgeColor, toggleColorScheme, useResolvedTheme } from "../lib/theme";
import { TimeframeSec } from "../lib/types";
import { useMarketSocket } from "../lib/useMarketSocket";
import { useMarketStore } from "../store/useMarketStore";

interface Props {
  onLogout: () => void;
  onGoAdmin: () => void;
}

const TIMEFRAMES: Array<{ sec: TimeframeSec; label: string }> = [
  { sec: 5, label: "5s" },
  { sec: 15, label: "15s" },
  { sec: 30, label: "30s" },
  { sec: 60, label: "1m" },
];

export function TradingTerminal({ onLogout, onGoAdmin }: Props) {
  useMarketSocket(true);
  const theme = useResolvedTheme();

  const user = useMarketStore((s) => s.user);
  const portfolio = useMarketStore((s) => s.portfolio);
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const timeframeSec = useMarketStore((s) => s.timeframeSec);
  const setTimeframeSec = useMarketStore((s) => s.setTimeframeSec);
  const connectionMode = useMarketStore((s) => s.connectionMode);
  const activeGatewayLabel = useMarketStore((s) => s.activeGatewayLabel);
  const activeHeadline = useMarketStore((s) => s.activeHeadline);
  const activeScenarioName = useMarketStore((s) => s.activeScenarioName);
  const magnetCrosshair = useMarketStore((s) => s.magnetCrosshair);
  const showEntryLine = useMarketStore((s) => s.showEntryLine);
  const showEraMarkers = useMarketStore((s) => s.showEraMarkers);
  const toggleMagnetCrosshair = useMarketStore((s) => s.toggleMagnetCrosshair);
  const toggleEntryLine = useMarketStore((s) => s.toggleEntryLine);
  const toggleEraMarkers = useMarketStore((s) => s.toggleEraMarkers);
  const dispatchChartCommand = useMarketStore((s) => s.dispatchChartCommand);
  const resetSession = useMarketStore((s) => s.resetSession);

  const netWorth = portfolio?.net_worth ?? 25000;
  const startingCapital = portfolio?.total_credited ?? 25000;
  const totalReturn = netWorth - startingCapital;
  const returnPct = startingCapital > 0 ? (totalReturn / startingCapital) * 100 : 0;
  const badgeColor = getSymbolBadgeColor(selectedSymbol);

  return (
    <div className="min-h-[100dvh] lg:h-[100dvh] bg-[var(--tv-bg)] text-[var(--tv-text)] flex flex-col overflow-x-hidden lg:overflow-hidden">
      {/* TradingView Top Navigation Toolbar */}
      <header className="h-11 bg-[var(--tv-bg)] border-b border-[var(--tv-border)] px-3 flex items-center justify-between gap-2 shrink-0 overflow-x-auto scroller">
        <div className="flex items-center gap-2 shrink-0">
          {/* Brand & Active Ticker */}
          <div className="flex items-center gap-2 pr-2 border-r border-[var(--tv-border)]">
            <span
              className="w-5 h-5 rounded-full text-[9px] font-bold text-white flex items-center justify-center"
              style={{ backgroundColor: badgeColor }}
            >
              {selectedSymbol.slice(0, 2)}
            </span>
            <span className="font-mono font-bold text-xs text-[var(--tv-text)]">{selectedSymbol}</span>
            <span className="hidden xl:inline text-[11px] font-semibold text-[var(--tv-muted)]">
              GENESIS 2026
            </span>
          </div>

          {/* Timeframe Selector */}
          <div className="flex items-center gap-0.5 pr-2 border-r border-[var(--tv-border)]">
            {TIMEFRAMES.map((tf) => {
              const active = timeframeSec === tf.sec;
              return (
                <button
                  key={tf.sec}
                  type="button"
                  onClick={() => setTimeframeSec(tf.sec)}
                  className={`px-2 py-1 rounded text-xs font-mono font-medium transition-colors ${
                    active
                      ? "bg-[#2962FF]/15 text-[#2962FF] font-semibold"
                      : "text-[var(--tv-muted)] hover:text-[var(--tv-text)] hover:bg-[var(--tv-hover)]"
                  }`}
                >
                  {tf.label}
                </button>
              );
            })}
          </div>

          {/* Quick Zoom Controls in Top Toolbar */}
          <div className="hidden md:flex items-center gap-0.5 pr-2 border-r border-[var(--tv-border)]">
            <button
              type="button"
              onClick={() => dispatchChartCommand("ZOOM_IN")}
              title="Zoom In"
              className="p-1.5 rounded text-[var(--tv-muted)] hover:text-[var(--tv-text)] hover:bg-[var(--tv-hover)] transition-colors"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => dispatchChartCommand("ZOOM_OUT")}
              title="Zoom Out"
              className="p-1.5 rounded text-[var(--tv-muted)] hover:text-[var(--tv-text)] hover:bg-[var(--tv-hover)] transition-colors"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => dispatchChartCommand("FIT")}
              title="Reset Chart Scale & Fit"
              className="px-2 py-1 rounded text-[11px] font-medium text-[var(--tv-muted)] hover:text-[var(--tv-text)] hover:bg-[var(--tv-hover)] transition-colors"
            >
              Reset View
            </button>
          </div>

          {/* Scenario Tag */}
          <span className="hidden 2xl:inline px-2 py-0.5 rounded bg-[var(--tv-surface)] border border-[var(--tv-border)] text-[10px] font-mono text-[var(--tv-muted)]">
            {activeScenarioName}
          </span>
        </div>

        {/* Right Telemetry + Actions */}
        <div className="flex items-center gap-2.5 text-xs shrink-0">
          <div
            className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold flex items-center gap-1 border ${
              connectionMode === "LIVE_WSS"
                ? "bg-[#089981]/10 text-[#089981] border-[#089981]/30"
                : connectionMode === "POLLING_FALLBACK"
                ? "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30"
                : "bg-[#F23645]/10 text-[#F23645] border-[#F23645]/30"
            }`}
          >
            <Radio className="w-3 h-3 animate-pulse" />
            <span>
              {connectionMode === "LIVE_WSS"
                ? `LIVE (${activeGatewayLabel})`
                : connectionMode === "POLLING_FALLBACK"
                ? "POLLING"
                : "SYNCING"}
            </span>
          </div>

          <div className="flex items-center gap-1.5 pl-2 border-l border-[var(--tv-border)]">
            <Wallet className="w-3.5 h-3.5 text-[var(--tv-muted)] hidden sm:inline" />
            <span className="text-[var(--tv-muted)] hidden sm:inline">Cash</span>
            <span className="font-mono font-semibold text-[var(--tv-text)] tabular-nums">
              ₹{(portfolio?.cash_balance ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[var(--tv-muted)] hidden md:inline">Equity</span>
            <span className="font-mono font-bold text-[var(--tv-text)] tabular-nums">
              ₹{netWorth.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
            <span
              className={`font-mono font-semibold tabular-nums ${
                totalReturn >= 0 ? "text-[#089981]" : "text-[#F23645]"
              }`}
            >
              ({totalReturn >= 0 ? "+" : ""}
              {returnPct.toFixed(2)}%)
            </span>
          </div>

          <div className="h-4 w-px bg-[var(--tv-border)] hidden sm:block" />

          <span className="hidden lg:inline font-mono text-[11px] px-1.5 py-0.5 rounded bg-[var(--tv-surface)] border border-[var(--tv-border)] text-[var(--tv-muted)]">
            {user?.registration_no}
          </span>

          <button
            type="button"
            onClick={() => toggleColorScheme()}
            title={theme === "dark" ? "Switch to TradingView Light Theme" : "Switch to TradingView Dark Theme"}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="p-1.5 rounded hover:bg-[var(--tv-hover)] text-[var(--tv-muted)] hover:text-[var(--tv-text)] transition-colors"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onGoAdmin}
            title="Admin Command Desk"
            className="p-1.5 rounded hover:bg-[var(--tv-hover)] text-[var(--tv-muted)] hover:text-[var(--tv-text)] transition-colors"
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
            className="p-1.5 rounded hover:bg-[var(--tv-hover)] text-[var(--tv-muted)] hover:text-[#F23645] transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Floor Wire Breaking News Bar */}
      <div className="bg-[var(--tv-surface)] border-b border-[var(--tv-border)] px-3 py-1 text-[11px] flex items-center gap-2 shrink-0">
        <span className="px-1.5 py-0.5 rounded bg-[#2962FF]/15 text-[#2962FF] font-mono font-bold text-[10px] shrink-0">
          WIRE
        </span>
        <p className="text-[var(--tv-text)] font-medium truncate">{activeHeadline}</p>
      </div>

      {/* Main TradingView Supercharts Grid: [Left Tools] + [Chart & Blotter] + [Watchlist + Inspector/Trade] */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[44px_1fr_340px] min-w-0 min-h-0">
        {/* Left Vertical Chart Toolbar */}
        <nav
          aria-label="Chart tools"
          className="hidden lg:flex flex-col items-center py-2.5 gap-2 bg-[var(--tv-bg)] border-r border-[var(--tv-border)] shrink-0"
        >
          <button
            type="button"
            onClick={() => dispatchChartCommand("FIT")}
            title="Crosshair / Reset Chart View"
            className="p-2 rounded hover:bg-[var(--tv-hover)] text-[var(--tv-muted)] hover:text-[var(--tv-text)] transition-colors"
          >
            <Crosshair className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={toggleMagnetCrosshair}
            title={magnetCrosshair ? "Magnet OHLC Snap: ON" : "Magnet OHLC Snap: OFF"}
            aria-pressed={magnetCrosshair}
            className={`p-2 rounded transition-colors ${
              magnetCrosshair
                ? "bg-[#2962FF]/15 text-[#2962FF]"
                : "text-[var(--tv-muted)] hover:text-[var(--tv-text)] hover:bg-[var(--tv-hover)]"
            }`}
          >
            <Magnet className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={toggleEntryLine}
            title={showEntryLine ? "Hide Avg Entry Price Line" : "Show Avg Entry Price Line"}
            aria-pressed={showEntryLine}
            className={`p-2 rounded transition-colors ${
              showEntryLine
                ? "bg-[#089981]/15 text-[#089981]"
                : "text-[var(--tv-muted)] hover:text-[var(--tv-text)] hover:bg-[var(--tv-hover)]"
            }`}
          >
            <Minus className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={toggleEraMarkers}
            title={showEraMarkers ? "Hide Era Shock Markers" : "Show Era Shock Markers"}
            aria-pressed={showEraMarkers}
            className={`p-2 rounded transition-colors ${
              showEraMarkers
                ? "bg-[#F59E0B]/15 text-[#F59E0B]"
                : "text-[var(--tv-muted)] hover:text-[var(--tv-text)] hover:bg-[var(--tv-hover)]"
            }`}
          >
            <Flag className="w-4 h-4" />
          </button>

          <div className="w-5 h-px bg-[var(--tv-border)] my-1" />

          <button
            type="button"
            onClick={() => dispatchChartCommand("ZOOM_IN")}
            title="Zoom In Candles"
            className="p-2 rounded text-[var(--tv-muted)] hover:text-[var(--tv-text)] hover:bg-[var(--tv-hover)] transition-colors"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => dispatchChartCommand("ZOOM_OUT")}
            title="Zoom Out Candles"
            className="p-2 rounded text-[var(--tv-muted)] hover:text-[var(--tv-text)] hover:bg-[var(--tv-hover)] transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => dispatchChartCommand("FIT")}
            title="Fit & Auto-Scale Chart"
            className="p-2 rounded text-[var(--tv-muted)] hover:text-[var(--tv-text)] hover:bg-[var(--tv-hover)] transition-colors"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </nav>

        {/* Center Stage: Candlestick Chart + Holdings Blotter */}
        <div className="flex flex-col min-w-0 min-h-0">
          <div className="flex-1 min-h-[380px] min-w-0">
            <CandlestickChart />
          </div>
          <HoldingsBlotter />
        </div>

        {/* Right Sidebar: Top Watchlist Table + Bottom Stock Inspector & Execution Ticket */}
        <aside className="border-t lg:border-t-0 lg:border-l border-[var(--tv-border)] flex flex-col min-w-0 min-h-0 bg-[var(--tv-bg)] overflow-y-auto lg:overflow-hidden">
          <div className="flex-1 min-h-[260px] min-w-0">
            <WatchlistSidebar />
          </div>
          <div className="shrink-0 min-w-0">
            <ExecutionDock />
          </div>
        </aside>
      </main>
    </div>
  );
}
