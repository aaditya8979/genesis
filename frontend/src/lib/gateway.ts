import { CandleBar } from "./types";

const PRIMARY_HTTP = import.meta.env.VITE_API_URL || "";
const FALLBACK_RAW = import.meta.env.VITE_FALLBACK_URLS || "";

export const GATEWAY_HTTP_ENDPOINTS: string[] = [
  PRIMARY_HTTP,
  ...FALLBACK_RAW.split(",")
    .map((s: string) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean),
].filter((v, i, a) => a.indexOf(v) === i);

let activeGatewayIndex = 0;

export function getActiveHttpBase(): string {
  return GATEWAY_HTTP_ENDPOINTS[activeGatewayIndex] ?? "";
}

export function getActiveWsUrl(path: string): string {
  const explicitWs = import.meta.env.VITE_WS_URL;
  if (activeGatewayIndex === 0 && explicitWs && path === "/ws/market") {
    return explicitWs;
  }
  const base = getActiveHttpBase();
  if (!base) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}${path}`;
  }
  return base.replace(/^http/, "ws") + path;
}

export function rotateGateway(): string {
  if (GATEWAY_HTTP_ENDPOINTS.length > 1) {
    activeGatewayIndex = (activeGatewayIndex + 1) % GATEWAY_HTTP_ENDPOINTS.length;
  }
  return getActiveHttpBase();
}

export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("genesis_token");
  const adminSecret = localStorage.getItem("genesis_admin_secret");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token && !headers["Authorization"]) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (adminSecret && (path.includes("/admin") || path.includes("/system/")) && !headers["X-Admin-Secret"]) {
    headers["X-Admin-Secret"] = adminSecret;
  }

  let lastErr: Error | null = null;
  const attempts = Math.max(1, GATEWAY_HTTP_ENDPOINTS.length);

  for (let i = 0; i < attempts; i++) {
    const base = getActiveHttpBase();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${base}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          detail = j.detail || detail;
        } catch {
          // ignore
        }
        // Only rotate gateway on 502/503/504 infrastructure errors, not 4xx validation errors
        if (res.status >= 502 && attempts > 1 && i < attempts - 1) {
          rotateGateway();
          continue;
        }
        throw new ApiError(detail, res.status);
      }
      return (await res.json()) as T;
    } catch (err: any) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (err?.name === "AbortError" || err?.message?.includes("Failed to fetch")) {
        rotateGateway();
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr || new ApiError("All backend gateways unreachable", 503);
}

// Local Ring Buffer cache for zero-blank-screen insurance on transient disconnects
const CACHE_KEY = "genesis_candle_ring_cache";

export function saveCandleRingCache(candlesBySymbol: Record<string, CandleBar[]>): void {
  try {
    const trimmed: Record<string, CandleBar[]> = {};
    for (const [sym, bars] of Object.entries(candlesBySymbol)) {
      trimmed[sym] = bars.slice(-120);
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(trimmed));
  } catch {
    // quota full, ignore safely
  }
}

export function loadCandleRingCache(): Record<string, CandleBar[]> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

