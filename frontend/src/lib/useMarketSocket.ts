import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { apiFetch, getActiveHttpBase, getActiveWsUrl, rotateGateway } from "./gateway";
import { useMarketStore } from "../store/useMarketStore";

export function useMarketSocket(enabled: boolean) {
  const wsRef = useRef<WebSocket | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const failedWsCountRef = useRef<number>(0);

  const hydrateBootstrap = useMarketStore((s) => s.hydrateBootstrap);
  const applyTickPayload = useMarketStore((s) => s.applyTickPayload);
  const applyPortfolioUpdate = useMarketStore((s) => s.applyPortfolioUpdate);
  const setFrozenStatus = useMarketStore((s) => s.setFrozenStatus);
  const setConnectionMode = useMarketStore((s) => s.setConnectionMode);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;

    const clearTimers = () => {
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      heartbeatRef.current = null;
      pollTimerRef.current = null;
      reconnectTimerRef.current = null;
    };

    const startPollingFallback = () => {
      if (pollTimerRef.current || disposed) return;
      setConnectionMode("POLLING_FALLBACK", getActiveHttpBase() ? "STANDBY" : "PRIMARY");
      toast.warning("Firewall switched feed to HTTPS Polling fallback — market remains live.");

      pollTimerRef.current = window.setInterval(async () => {
        if (disposed) return;
        try {
          const seq = useMarketStore.getState().seq;
          const payload = await apiFetch<any>(`/api/v1/market/ticks?since_seq=${seq}`);
          applyTickPayload(payload);
        } catch {
          // gateway rotation handled inside apiFetch
        }
      }, 1000);
    };

    const connectWs = () => {
      if (disposed) return;
      const token = localStorage.getItem("genesis_token") || "";
      const wsUrl = getActiveWsUrl(`/ws/market?token=${encodeURIComponent(token)}`);
      setConnectionMode(failedWsCountRef.current > 0 ? "RECONNECTING" : "CONNECTING");

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        failedWsCountRef.current += 1;
        if (failedWsCountRef.current >= 3) startPollingFallback();
        return;
      }

      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }
        failedWsCountRef.current = 0;
        if (pollTimerRef.current) {
          window.clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        setConnectionMode("LIVE_WSS", "LIVE");

        // 15s heartbeat keeps Fortinet DPI from reaping socket at 30s
        if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 15000);
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === "pong") return;

          if (msg.event === "CASH_TOPUP") {
            if (msg.portfolio) applyPortfolioUpdate(msg.portfolio);
            toast.success(msg.message || `Wallet credited +₹${msg.amount}`, { duration: 6000 });
            return;
          }

          if (msg.event === "ACCOUNT_STATUS") {
            setFrozenStatus(Boolean(msg.is_frozen));
            if (msg.is_frozen) toast.error(msg.message, { duration: 8000 });
            else toast.success(msg.message, { duration: 5000 });
            return;
          }

          if (msg.event === "FORCED_LIQUIDATION") {
            toast.error(
              `SHORT SQUEEZE LIQUIDATION: ${msg.data.qty} ${msg.data.symbol} @ ₹${msg.data.price} (P&L ₹${msg.data.pnl})`,
              { duration: 8000 }
            );
            apiFetch<any>("/api/v1/bootstrap").then(hydrateBootstrap).catch(() => {});
            return;
          }

          if (msg.event === "ERA_SHOCK") {
            toast.info(msg.active_headline, { duration: 7000 });
          } else if (msg.event === "WHALE_ALERT" || msg.event === "GLOBAL_ALERT") {
            toast.warning(msg.active_headline, { duration: 6000 });
          }

          applyTickPayload(msg);
        } catch {
          // ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (heartbeatRef.current) {
          window.clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
        if (disposed) return;

        failedWsCountRef.current += 1;
        setConnectionMode("RECONNECTING");

        if (failedWsCountRef.current >= 3) {
          rotateGateway();
          startPollingFallback();
        }

        // Jittered exponential backoff prevents thundering herd across 1,000 students
        const baseDelay = Math.min(1000 * Math.pow(2, Math.min(failedWsCountRef.current, 4)), 10000);
        const jitter = Math.random() * 1800;
        reconnectTimerRef.current = window.setTimeout(connectWs, baseDelay + jitter);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        apiFetch<any>("/api/v1/bootstrap")
          .then(hydrateBootstrap)
          .catch(() => {});
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          connectWs();
        } else {
          wsRef.current.send(JSON.stringify({ type: "resync" }));
        }
      }
    };

    connectWs();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      clearTimers();
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [enabled, applyPortfolioUpdate, applyTickPayload, hydrateBootstrap, setConnectionMode, setFrozenStatus]);
}

