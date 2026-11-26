import { useEffect, useState } from "react";

export type ResolvedTheme = "light" | "dark";

export function getSystemScheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getRenderedTheme(): ResolvedTheme {
  const meta = document.querySelector('meta[name="color-scheme"]')?.getAttribute("content");
  if (meta === "light" || meta === "dark") return meta;
  return getSystemScheme();
}

export function toggleColorScheme(): ResolvedTheme {
  const current = getRenderedTheme();
  const target: ResolvedTheme = current === "dark" ? "light" : "dark";
  try {
    localStorage.setItem("color-scheme", target);
  } catch {
    // ignore storage errors
  }
  const metaEl = document.querySelector('meta[name="color-scheme"]');
  if (metaEl) {
    metaEl.setAttribute("content", target);
  }
  return target;
}

export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(() =>
    typeof window !== "undefined" ? getRenderedTheme() : "dark"
  );

  useEffect(() => {
    const sync = () => setTheme(getRenderedTheme());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", sync);

    const metaEl = document.querySelector('meta[name="color-scheme"]');
    let observer: MutationObserver | null = null;
    if (metaEl) {
      observer = new MutationObserver(sync);
      observer.observe(metaEl, { attributes: true, attributeFilter: ["content"] });
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key === "color-scheme") {
        const meta = document.querySelector('meta[name="color-scheme"]');
        if (meta) meta.setAttribute("content", e.newValue ?? "dark");
        sync();
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      mq.removeEventListener("change", sync);
      observer?.disconnect();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return theme;
}

const BADGE_PALETTE = [
  "#2962FF",
  "#089981",
  "#7E57C2",
  "#F59E0B",
  "#EC4899",
  "#06B6D4",
  "#6366F1",
  "#10B981",
];

export function getSymbolBadgeColor(symbol: string): string {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) {
    h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  }
  return BADGE_PALETTE[h % BADGE_PALETTE.length];
}
