import { useEffect, useMemo, useRef } from "react";
import { ColorType, CrosshairMode, IChartApi, ISeriesApi, createChart } from "lightweight-charts";
import { useMarketStore } from "../store/useMarketStore";
import { CandleBar } from "../lib/types";

function resampleCandles(bars5s: CandleBar[], tfSec: 5 | 15 | 60): CandleBar[] {
  if (!bars5s || bars5s.length === 0) return [];
  if (tfSec === 5) return bars5s;

  const grouped: CandleBar[] = [];
  for (const b of bars5s) {
    const bucket = Math.floor(b.time / tfSec) * tfSec;
    const last = grouped[grouped.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume += b.volume;
    } else {
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

export function CandlestickChart() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const timeframeSec = useMarketStore((s) => s.timeframeSec);
  const rawBars = useMarketStore((s) => s.candles[s.selectedSymbol]);
  const eraMarkers = useMarketStore((s) => s.eraMarkers);

  const resampled = useMemo(() => resampleCandles(rawBars || [], timeframeSec), [rawBars, timeframeSec]);

  // Initialize TradingView Lightweight Chart once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "#121721" },
        textColor: "#8A94A6",
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(35, 43, 58, 0.55)" },
        horzLines: { color: "rgba(35, 43, 58, 0.55)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#475569", labelBackgroundColor: "#1E293B" },
        horzLine: { color: "#475569", labelBackgroundColor: "#1E293B" },
      },
      rightPriceScale: {
        borderColor: "#232B3A",
        scaleMargins: { top: 0.1, bottom: 0.22 },
      },
      timeScale: {
        borderColor: "#232B3A",
        timeVisible: true,
        secondsVisible: true,
      },
      handleScroll: true,
      handleScale: true,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#00D09C",
      downColor: "#EB5B3C",
      borderUpColor: "#00D09C",
      borderDownColor: "#EB5B3C",
      wickUpColor: "#00D09C",
      wickDownColor: "#EB5B3C",
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          chart.applyOptions({ width, height });
        }
      }
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  // Push initial historical series or full symbol/timeframe switch
  const lastSymbolRef = useRef<string>("");
  const lastTfRef = useRef<number>(0);

  useEffect(() => {
    const cs = candleSeriesRef.current;
    const vs = volumeSeriesRef.current;
    if (!cs || !vs || resampled.length === 0) return;

    const symbolOrTfChanged =
      lastSymbolRef.current !== selectedSymbol || lastTfRef.current !== timeframeSec;

    if (symbolOrTfChanged || resampled.length <= 2) {
      cs.setData(resampled as any);
      vs.setData(
        resampled.map((b) => ({
          time: b.time as any,
          value: b.volume,
          color: b.close >= b.open ? "rgba(0, 208, 156, 0.25)" : "rgba(235, 91, 60, 0.25)",
        }))
      );
      chartRef.current?.timeScale().fitContent();
      lastSymbolRef.current = selectedSymbol;
      lastTfRef.current = timeframeSec;
    } else {
      // Smooth 60 FPS imperative last-bar update without resetting zoom/pan
      const latest = resampled[resampled.length - 1];
      cs.update(latest as any);
      vs.update({
        time: latest.time as any,
        value: latest.volume,
        color: latest.close >= latest.open ? "rgba(0, 208, 156, 0.25)" : "rgba(235, 91, 60, 0.25)",
      });
    }

    if (eraMarkers.length > 0) {
      cs.setMarkers(
        eraMarkers.map((m) => ({
          time: (Math.floor(m.time / timeframeSec) * timeframeSec) as any,
          position: "aboveBar",
          color: m.color,
          shape: "arrowDown",
          text: m.label.replace("ERA_", "E"),
        }))
      );
    }
  }, [resampled, selectedSymbol, timeframeSec, eraMarkers]);

  return <div ref={containerRef} className="w-full h-full min-h-[340px]" />;
}

