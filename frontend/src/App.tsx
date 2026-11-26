import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { LoginGate } from "./components/LoginGate";
import { apiFetch } from "./lib/gateway";
import { AdminPortal } from "./pages/AdminPortal";
import { TradingTerminal } from "./pages/TradingTerminal";
import { useMarketStore } from "./store/useMarketStore";

export default function App() {
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
    apiFetch<any>("/api/v1/bootstrap")
      .then((data) => {
        hydrateBootstrap(data);
        setHydrating(false);
      })
      .catch(() => {
        localStorage.removeItem("genesis_token");
        setRoute("LOGIN");
        setHydrating(false);
      });
  }, [route, hydrateBootstrap]);

  return (
    <>
      <Toaster theme="dark" position="top-right" richColors closeButton />
      {route === "ADMIN" ? (
        <AdminPortal onBackTerminal={() => setRoute(localStorage.getItem("genesis_token") ? "TERMINAL" : "LOGIN")} />
      ) : route === "LOGIN" ? (
        <LoginGate
          onSuccess={() => setRoute("TERMINAL")}
          onGoAdmin={() => setRoute("ADMIN")}
        />
      ) : hydrating ? (
        <div className="min-h-[100dvh] bg-[#0B0E14] text-[#8A94A6] flex items-center justify-center font-mono text-sm">
          Hydrating wallet & live candles from GENESIS Floor...
        </div>
      ) : (
        <TradingTerminal
          onLogout={() => setRoute("LOGIN")}
          onGoAdmin={() => setRoute("ADMIN")}
        />
      )}
    </>
  );
}

