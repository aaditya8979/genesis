import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  ColorType,
  CrosshairMode,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  PriceScaleMode,
  SeriesMarker,
  Time,
  createChart,
} from "lightweight-charts";
import { CandleBar, TimeframeSec } from "../lib/types";
import { getSymbolBadgeColor, useResolvedTheme } from "../lib/theme";
import { useMarketStore } from "../store/useMarketStore";

function resampleCandles(bars5s: CandleBar[] | undefined, tfSec: TimeframeSec): CandleBar[] {
  if (!bars5s || bars5s.length === 0) return [];

  const sorted = [...bars5s].sort((a, b) => a.time - b.time);
  const grouped: CandleBar[] = [];

  for (const b of sorted) {
    if (!Number.isFinite(b.time) || !Number.isFinite(b.close) || b.close <= 0) continue;
    const bucket = Math.floor(b.time / tfSec) * tfSec;
    const last = grouped[grouped.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume += b.volume;
    } else if (!last || bucket > last.time) {
      grouped.push({
        time: bucket,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      });
    }
  }
  return grouped;
}

function formatVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return String(v);
}

function formatIstClock(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleTimeString("en-IN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const CHART_PALETTE = {
  dark: {
    bg: "#0F0F0F",
    text: "#8A8A8A",
    grid: "rgba(255, 255, 255, 0.045)",
    border: "#2A2A2A",
    crosshair: "#4D4D4D",
    crosshairLabel: "#262626",
  },
  light: {
    bg: "#FFFFFF",
    text: "#6A6D78",
    grid: "rgba(224, 227, 235, 0.7)",
    border: "#E0E3EB",
    crosshair: "#9598A1",
    crosshairLabel: "#131722",
  },
};

export function CandlestickChart() {
  const theme = useResolvedTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const entryPriceLineRef = useRef<IPriceLine | null>(null);
  const hasFittedWidthRef = useRef<boolean>(false);

  const oRef = useRef<HTMLSpanElement | null>(null);
  const hRef = useRef<HTMLSpanElement | null>(null);
  const lRef = useRef<HTMLSpanElement | null>(null);
  const cRef = useRef<HTMLSpanElement | null>(null);
  const chgRef = useRef<HTMLSpanElement | null>(null);
  const volRef = useRef<HTMLSpanElement | null>(null);

  const [showHudQuotes, setShowHudQuotes] = useState(true);
  const [clockText, setClockText] = useState(() =>
    new Date().toLocaleTimeString("en-IN", { hour12: false })
  );

  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const stock = useMarketStore((s) => s.stocks[s.selectedSymbol]);
  const portfolio = useMarketStore((s) => s.portfolio);
  const isMarketOpen = useMarketStore((s) => s.isMarketOpen);
  const timeframeSec = useMarketStore((s) => s.timeframeSec);
  const rawBars = useMarketStore((s) => s.candles[s.selectedSymbol]);
  const chartMarkers = useMarketStore((s) => s.chartMarkers);
  const magnetCrosshair = useMarketStore((s) => s.magnetCrosshair);
  const showEntryLine = useMarketStore((s) => s.showEntryLine);
  const showEraMarkers = useMarketStore((s) => s.showEraMarkers);
  const autoScale = useMarketStore((s) => s.autoScale);
  const priceScaleMode = useMarketStore((s) => s.priceScaleMode);
  const chartCommand = useMarketStore((s) => s.chartCommand);
  const chartCommandNonce = useMarketStore((s) => s.chartCommandNonce);
  const dispatchChartCommand = useMarketStore((s) => s.dispatchChartCommand);
  const setAutoScale = useMarketStore((s) => s.setAutoScale);
  const setPriceScaleMode = useMarketStore((s) => s.setPriceScaleMode);
  const setPreferredOrderTab = useMarketStore((s) => s.setPreferredOrderTab);

  const resampled = useMemo(() => resampleCandles(rawBars, timeframeSec), [rawBars, timeframeSec]);
  const latestBarRef = useRef<CandleBar | null>(null);
  const resampledRef = useRef<CandleBar[]>([]);
  resampledRef.current = resampled;
  latestBarRef.current = resampled.length > 0 ? resampled[resampled.length - 1] : null;

  const paintOhlcDom = (bar: CandleBar | null) => {
    if (!bar) return;
    const isUp = bar.close >= bar.open;
    const cls = isUp ? "text-[#089981]" : "text-[#F23645]";
    const delta = bar.close - bar.open;
    const pct = bar.open > 0 ? (delta / bar.open) * 100 : 0;

    if (oRef.current) {
      oRef.current.textContent = bar.open.toFixed(2);
      oRef.current.className = `font-mono tabular-nums ${cls}`;
    }
    if (hRef.current) {
      hRef.current.textContent = bar.high.toFixed(2);
      hRef.current.className = `font-mono tabular-nums ${cls}`;
    }
    if (lRef.current) {
      lRef.current.textContent = bar.low.toFixed(2);
      lRef.current.className = `font-mono tabular-nums ${cls}`;
    }
    if (cRef.current) {
      cRef.current.textContent = bar.close.toFixed(2);
      cRef.current.className = `font-mono font-semibold tabular-nums ${cls}`;
    }
    if (chgRef.current) {
      chgRef.current.textContent = `${delta >= 0 ? "+" : ""}${delta.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
      chgRef.current.className = `font-mono tabular-nums ${cls}`;
    }
    if (volRef.current) {
      volRef.current.textContent = formatVol(bar.volume);
    }
  };

  useEffect(() => {
    const t = window.setInterval(() => {
      setClockText(new Date().toLocaleTimeString("en-IN", { hour12: false }));
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const pal = CHART_PALETTE[getInitialTheme()];

    const chart = createChart(el, {
      width: el.clientWidth || 920,
      height: el.clientHeight || 500,
      layout: {
        background: { type: ColorType.Solid, color: pal.bg },
        textColor: pal.text,
        fontFamily: '"IBM Plex Mono", "Trebuchet MS", sans-serif',
        fontSize: 11,
      },
      localization: {
        timeFormatter: (ts: number) => formatIstClock(ts),
      },
      grid: {
        vertLines: { color: pal.grid },
        horzLines: { color: pal.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: pal.crosshair, labelBackgroundColor: pal.crosshairLabel, width: 1, style: 2 },
        horzLine: { color: pal.crosshair, labelBackgroundColor: pal.crosshairLabel, width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: pal.border,
        autoScale: true,
        scaleMargins: { top: 0.12, bottom: 0.25 },
      },
      timeScale: {
        borderColor: pal.border,
        timeVisible: true,
        secondsVisible: true,
        barSpacing: 9,
        minBarSpacing: 2,
        rightOffset: 8,
        shiftVisibleRangeOnNewBar: true,
        lockVisibleTimeRangeOnResize: false,
        tickMarkFormatter: (time: number) => formatIstClock(time),
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
        mouseWheel: true,
        pinch: true,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#089981",
      downColor: "#F23645",
      borderUpColor: "#089981",
      borderDownColor: "#F23645",
      wickUpColor: "#089981",
      wickDownColor: "#F23645",
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.84, bottom: 0 },
      visible: false,
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData) {
        paintOhlcDom(latestBarRef.current);
        return;
      }
      const cData = param.seriesData.get(candleSeries) as CandleBar | undefined;
      const vData = param.seriesData.get(volumeSeries) as { value?: number } | undefined;
      if (cData && typeof cData.open === "number") {
        paintOhlcDom({
          time: Number(cData.time),
          open: cData.open,
          high: cData.high,
          low: cData.low,
          close: cData.close,
          volume: vData?.value ?? 0,
        });
      } else {
        paintOhlcDom(latestBarRef.current);
      }
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          chart.applyOptions({ width, height });
          const len = resampledRef.current.length;
          if (!hasFittedWidthRef.current && width > 120 && len > 0) {
            hasFittedWidthRef.current = true;
            const visibleWindow = Math.min(Math.max(len, 24), 40);
            chart.timeScale().setVisibleLogicalRange({
              from: Math.max(-2, len - visibleWindow),
              to: len + 6,
            });
            chart.priceScale("right").applyOptions({ autoScale: true });
          }
        }
      }
    });
    resizeObserver.observe(el);

    return () => {
      hasFittedWidthRef.current = false;
      renderedKeyRef.current = "";
      renderedLenRef.current = 0;
      firstTimeRef.current = 0;
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      entryPriceLineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const pal = CHART_PALETTE[theme];
    const modeEnum =
      priceScaleMode === "LOG"
        ? PriceScaleMode.Logarithmic
        : priceScaleMode === "PERCENT"
        ? PriceScaleMode.Percentage
        : PriceScaleMode.Normal;

    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: pal.bg },
        textColor: pal.text,
      },
      grid: {
        vertLines: { color: pal.grid },
        horzLines: { color: pal.grid },
      },
      crosshair: {
        mode: magnetCrosshair ? CrosshairMode.Magnet : CrosshairMode.Normal,
        vertLine: { color: pal.crosshair, labelBackgroundColor: pal.crosshairLabel },
        horzLine: { color: pal.crosshair, labelBackgroundColor: pal.crosshairLabel },
      },
      rightPriceScale: {
        borderColor: pal.border,
        autoScale,
        mode: modeEnum,
      },
      timeScale: {
        borderColor: pal.border,
        secondsVisible: timeframeSec < 60,
      },
    });
  }, [theme, magnetCrosshair, autoScale, priceScaleMode, timeframeSec]);

  const renderedKeyRef = useRef<string>("");
  const renderedLenRef = useRef<number>(0);
  const firstTimeRef = useRef<number>(0);

  useEffect(() => {
    const cs = candleSeriesRef.current;
    const vs = volumeSeriesRef.current;
    const chart = chartRef.current;
    if (!cs || !vs || !chart || resampled.length === 0) return;

    const currentKey = `${selectedSymbol}:${timeframeSec}`;
    const firstTs = resampled[0].time;
    const needsFullReset =
      renderedKeyRef.current !== currentKey ||
      renderedLenRef.current === 0 ||
      resampled.length < renderedLenRef.current ||
      firstTs < firstTimeRef.current ||
      (renderedLenRef.current <= 3 && resampled.length > 10);

    if (needsFullReset) {
      cs.setData(
        resampled.map((b) => ({
          time: b.time as Time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        }))
      );
      vs.setData(
        resampled.map((b) => ({
          time: b.time as Time,
          value: b.volume,
          color: b.close >= b.open ? "rgba(8, 153, 129, 0.34)" : "rgba(242, 54, 69, 0.34)",
        }))
      );

      const len = resampled.length;
      const visibleWindow = Math.min(Math.max(len, 24), 40);
      const applyRange = () => {
        const activeChart = chartRef.current;
        if (!activeChart) return;
        activeChart.priceScale("right").applyOptions({ autoScale: true });
        const w = containerRef.current?.clientWidth ?? 0;
        if (w > 120) {
          hasFittedWidthRef.current = true;
          activeChart.timeScale().setVisibleLogicalRange({
            from: Math.max(-2, len - visibleWindow),
            to: len + 6,
          });
        }
      };
      setAutoScale(true);
      applyRange();
      requestAnimationFrame(applyRange);

      renderedKeyRef.current = currentKey;
      renderedLenRef.current = len;
      firstTimeRef.current = firstTs;
    } else {
      const startIdx = Math.max(0, renderedLenRef.current - 1);
      for (let i = startIdx; i < resampled.length; i++) {
        const b = resampled[i];
        cs.update({
          time: b.time as Time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        });
        vs.update({
          time: b.time as Time,
          value: b.volume,
          color: b.close >= b.open ? "rgba(8, 153, 129, 0.34)" : "rgba(242, 54, 69, 0.34)",
        });
      }
      renderedLenRef.current = resampled.length;
    }

    paintOhlcDom(resampled[resampled.length - 1]);

    if (showEraMarkers && chartMarkers.length > 0 && resampled.length > 0) {
      const minBarTime = resampled[0].time;
      const relevant = chartMarkers.filter(
        (m) => m.symbol === "ALL" || m.symbol === selectedSymbol
      );
      const sortedMarkers = relevant
        .map((m) => ({
          time: Math.floor(m.time / timeframeSec) * timeframeSec,
          color: m.color,
          label: m.label,
        }))
        .filter((m) => m.time >= minBarTime)
        .sort((a, b) => a.time - b.time);

      const seenTimes = new Set<number>();
      const validMarkers: SeriesMarker<Time>[] = [];
      for (const m of sortedMarkers) {
        if (seenTimes.has(m.time)) continue;
        seenTimes.add(m.time);
        validMarkers.push({
          time: m.time as Time,
          position: "aboveBar",
          color: m.color || "#F59E0B",
          shape: "arrowDown",
          text: m.label.slice(0, 14),
        });
      }
      cs.setMarkers(validMarkers);
    } else {
      cs.setMarkers([]);
    }
  }, [resampled, selectedSymbol, timeframeSec, chartMarkers, showEraMarkers]);

  useEffect(() => {
    const cs = candleSeriesRef.current;
    if (!cs) return;
    if (entryPriceLineRef.current) {
      cs.removePriceLine(entryPriceLineRef.current);
      entryPriceLineRef.current = null;
    }
    if (!showEntryLine) return;

    const holding = portfolio?.holdings.find((h) => h.symbol === selectedSymbol);
    if (holding) {
      const isLong = holding.position_type === "LONG";
      entryPriceLineRef.current = cs.createPriceLine({
        price: holding.avg_entry_price,
        color: isLong ? "#089981" : "#F59E0B",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `${holding.position_type} ${holding.quantity} @ ₹${holding.avg_entry_price.toFixed(2)}`,
      });
    }
  }, [selectedSymbol, portfolio?.holdings, showEntryLine, resampled.length]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartCommand) return;
    const ts = chart.timeScale();
    const len = resampledRef.current.length;
    if (len === 0) return;

    if (chartCommand === "FIT") {
      const w = Math.min(Math.max(len, 24), 40);
      ts.setVisibleLogicalRange({ from: Math.max(-2, len - w), to: len + 6 });
      chart.priceScale("right").applyOptions({ autoScale: true });
      setAutoScale(true);
    } else if (chartCommand === "RANGE_ALL") {
      ts.fitContent();
    } else if (chartCommand === "RANGE_10M") {
      const bars = Math.max(10, Math.round(600 / timeframeSec));
      ts.setVisibleLogicalRange({ from: Math.max(-2, len - bars), to: len + 6 });
    } else if (chartCommand === "RANGE_30M") {
      const bars = Math.max(15, Math.round(1800 / timeframeSec));
      ts.setVisibleLogicalRange({ from: Math.max(-2, len - bars), to: len + 6 });
    } else if (chartCommand === "ZOOM_IN" || chartCommand === "ZOOM_OUT") {
      const range = ts.getVisibleLogicalRange();
      if (range) {
        const span = range.to - range.from;
        const factor = chartCommand === "ZOOM_IN" ? 0.72 : 1.38;
        const nextSpan = Math.min(Math.max(span * factor, 10), Math.max(len + 20, 480));
        ts.setVisibleLogicalRange({
          from: range.to - nextSpan,
          to: range.to,
        });
      }
    }
  }, [chartCommandNonce, chartCommand, timeframeSec, setAutoScale]);

  const spotPrice = stock?.price ?? 0;
  const badgeColor = getSymbolBadgeColor(selectedSymbol);
  const tfLabel = timeframeSec === 60 ? "1m" : `${timeframeSec}s`;

  return (
    <div className="relative flex flex-col w-full h-full min-h-[380px] bg-[var(--tv-bg)] select-none">
      {/* TradingView Canvas Wrapper */}
      <div
        className="relative flex-1 min-h-0 w-full"
        onDoubleClick={() => dispatchChartCommand("FIT")}
      >
        {/* Top-Left TradingView OHLCV Legend + Instant Sell/Buy Quote Boxes */}
        <div className="pointer-events-none absolute top-2.5 left-3 right-20 z-10 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
            <div className="flex items-center gap-1.5">
              <span
                className="w-5 h-5 rounded-full text-[9px] font-bold text-white flex items-center justify-center shrink-0"
                style={{ backgroundColor: badgeColor }}
              >
                {selectedSymbol.slice(0, 2)}
              </span>
              <span className="font-semibold text-[var(--tv-text)]">
                {stock?.company_name || selectedSymbol}
              </span>
              <span className="text-[var(--tv-muted)]">·</span>
              <span className="font-mono text-[11px] font-semibold text-[var(--tv-text)]">{tfLabel}</span>
              <span className="text-[var(--tv-muted)]">·</span>
              <span className="text-[11px] text-[var(--tv-muted)] font-medium">GENESIS</span>
            </div>

            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${
                isMarketOpen
                  ? "bg-[#089981]/15 text-[#089981]"
                  : "bg-[#F23645]/15 text-[#F23645]"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isMarketOpen ? "bg-[#089981]" : "bg-[#F23645]"}`} />
              {isMarketOpen ? "Live" : "Paused"}
            </span>

            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums">
              <span className="text-[var(--tv-muted)]">
                O<span ref={oRef} className="ml-0.5">—</span>
              </span>
              <span className="text-[var(--tv-muted)]">
                H<span ref={hRef} className="ml-0.5">—</span>
              </span>
              <span className="text-[var(--tv-muted)]">
                L<span ref={lRef} className="ml-0.5">—</span>
              </span>
              <span className="text-[var(--tv-muted)]">
                C<span ref={cRef} className="ml-0.5">—</span>
              </span>
              <span ref={chgRef} className="ml-0.5">—</span>
            </div>
          </div>

          {showHudQuotes && (
            <div className="pointer-events-auto flex items-center gap-2 w-fit">
              <button
                type="button"
                onClick={() => setPreferredOrderTab("SELL")}
                className="px-2.5 py-1 rounded border border-[#F23645]/75 bg-[var(--tv-bg)]/95 hover:bg-[#F23645]/10 transition-colors flex flex-col items-center leading-tight"
                title="Switch Order Ticket to SELL"
              >
                <span className="font-mono text-[11px] font-bold text-[#F23645] tabular-nums">
                  {spotPrice.toFixed(2)}
                </span>
                <span className="text-[9px] font-bold uppercase tracking-wider text-[#F23645]">
                  SELL
                </span>
              </button>

              <span className="font-mono text-[10px] text-[var(--tv-muted)] tabular-nums">0.00</span>

              <button
                type="button"
                onClick={() => setPreferredOrderTab("BUY")}
                className="px-2.5 py-1 rounded border border-[#2962FF]/80 bg-[var(--tv-bg)]/95 hover:bg-[#2962FF]/10 transition-colors flex flex-col items-center leading-tight"
                title="Switch Order Ticket to BUY"
              >
                <span className="font-mono text-[11px] font-bold text-[#2962FF] tabular-nums">
                  {spotPrice.toFixed(2)}
                </span>
                <span className="text-[9px] font-bold uppercase tracking-wider text-[#2962FF]">
                  BUY
                </span>
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 text-[11px] font-mono text-[var(--tv-muted)] tabular-nums">
            <span>
              Vol <span ref={volRef} className="text-[#089981] font-semibold">—</span>
            </span>
            <button
              type="button"
              onClick={() => setShowHudQuotes((v) => !v)}
              title={showHudQuotes ? "Collapse Buy/Sell Overlay" : "Expand Buy/Sell Overlay"}
              className="pointer-events-auto p-0.5 rounded border border-[var(--tv-border)] bg-[var(--tv-surface)]/80 hover:bg-[var(--tv-hover)] text-[var(--tv-muted)] hover:text-[var(--tv-text)]"
            >
              {showHudQuotes ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
        </div>

        <div ref={containerRef} className="w-full h-full" />
      </div>

      {/* Bottom TradingView Range & Scale Bar */}
      <div className="h-8 border-t border-[var(--tv-border)] bg-[var(--tv-bg)] px-3 flex items-center justify-between gap-2 text-[11px] shrink-0">
        <div className="flex items-center gap-1">
          {[
            { label: "10m", cmd: "RANGE_10M" as const },
            { label: "30m", cmd: "RANGE_30M" as const },
            { label: "Fit", cmd: "FIT" as const },
            { label: "All", cmd: "RANGE_ALL" as const },
          ].map((btn) => (
            <button
              key={btn.label}
              type="button"
              onClick={() => dispatchChartCommand(btn.cmd)}
              className="px-2 py-0.5 rounded font-medium text-[var(--tv-muted)] hover:text-[var(--tv-text)] hover:bg-[var(--tv-hover)] transition-colors"
            >
              {btn.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5 font-mono">
          <span className="text-[var(--tv-muted)] tabular-nums hidden sm:inline">{clockText} IST</span>
          <span className="text-[var(--tv-muted)] hidden sm:inline">|</span>
          <button
            type="button"
            onClick={() => setPriceScaleMode(priceScaleMode === "PERCENT" ? "NORMAL" : "PERCENT")}
            title="Toggle Percentage Scale"
            className={`px-1.5 py-0.5 rounded text-[11px] font-semibold transition-colors ${
              priceScaleMode === "PERCENT"
                ? "text-[#2962FF] bg-[#2962FF]/10"
                : "text-[var(--tv-muted)] hover:text-[var(--tv-text)]"
            }`}
          >
            %
          </button>
          <button
            type="button"
            onClick={() => setPriceScaleMode(priceScaleMode === "LOG" ? "NORMAL" : "LOG")}
            title="Toggle Logarithmic Scale"
            className={`px-1.5 py-0.5 rounded text-[11px] font-semibold transition-colors ${
              priceScaleMode === "LOG"
                ? "text-[#2962FF] bg-[#2962FF]/10"
                : "text-[var(--tv-muted)] hover:text-[var(--tv-text)]"
            }`}
          >
            log
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !autoScale;
              setAutoScale(next);
              chartRef.current?.priceScale("right").applyOptions({ autoScale: next });
            }}
            title="Toggle Auto Price Scaling"
            className={`px-1.5 py-0.5 rounded text-[11px] font-semibold transition-colors ${
              autoScale
                ? "text-[#2962FF] bg-[#2962FF]/10"
                : "text-[var(--tv-muted)] hover:text-[var(--tv-text)]"
            }`}
          >
            auto
          </button>
        </div>
      </div>
    </div>
  );
}

function getInitialTheme(): "light" | "dark" {
  const meta = document.querySelector('meta[name="color-scheme"]')?.getAttribute("content");
  if (meta === "light" || meta === "dark") return meta;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
