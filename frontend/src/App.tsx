import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { LoginGate } from "./components/LoginGate";
import { apiFetch } from "./lib/gateway";
import { useResolvedTheme } from "./lib/theme";
import { AdminPortal } from "./pages/AdminPortal";
import { TradingTerminal } from "./pages/TradingTerminal";
import { useMarketStore } from "./store/useMarketStore";

export default function App() {
  const theme = useResolvedTheme();
  const [route, setRoute] = useState<"LOGIN" | "TERMINAL" | "ADMIN">(() => {
    if (window.location.pathname.startsWith("/admin")) return "ADMIN";
    return localStorage.getItem("genesis_token") ? "TERMINAL" : "LOGIN";
  });
  const [hydrating, setHydrating] = useState(route === "TERMINAL");

  const hydrateBootstrap = useMarketStore((s) => s.hydrateBootstrap);

  useEffect(() => {
    if (route !== "TERMINAL") return;
    const token = localStorage.getItem("genesis_token");
    if (!token) {
      setRoute("LOGIN");
      setHydrating(false);
      return;
    }
    setHydrating(true);
    let cancelled = false;
    let retryTimer: number | undefined;

    const boot = () => {
      apiFetch<any>("/api/v1/bootstrap")
        .then((data) => {
          if (cancelled) return;
          hydrateBootstrap(data);
          setHydrating(false);
        })
        .catch((err: any) => {
          if (cancelled) return;
          if (err?.status === 401 || err?.status === 403) {
            localStorage.removeItem("genesis_token");
            setRoute("LOGIN");
            setHydrating(false);
            return;
          }
          // Transient outage or standby failover in progress — keep JWT token and retry smoothly
          retryTimer = window.setTimeout(boot, 2000);
        });
    };

    boot();
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [route, hydrateBootstrap]);

  return (
    <>
      <Toaster theme={theme} position="bottom-left" richColors closeButton />
      {route === "ADMIN" ? (
        <AdminPortal
          onBackTerminal={() => setRoute(localStorage.getItem("genesis_token") ? "TERMINAL" : "LOGIN")}
        />
      ) : route === "LOGIN" ? (
        <LoginGate onSuccess={() => setRoute("TERMINAL")} onGoAdmin={() => setRoute("ADMIN")} />
      ) : hydrating ? (
        <div className="min-h-[100dvh] bg-[var(--tv-bg)] text-[var(--tv-muted)] flex items-center justify-center font-mono text-sm">
          Hydrating wallet &amp; live candles from GENESIS Floor...
        </div>
      ) : (
        <TradingTerminal onLogout={() => setRoute("LOGIN")} onGoAdmin={() => setRoute("ADMIN")} />
      )}
    </>
  );
}
