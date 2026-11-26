import { FormEvent, useState } from "react";
import { Moon, ShieldCheck, Sun, TrendingUp, Zap } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "../lib/gateway";
import { toggleColorScheme, useResolvedTheme } from "../lib/theme";
import { useMarketStore } from "../store/useMarketStore";

interface Props {
  onSuccess: () => void;
  onGoAdmin: () => void;
}

export function LoginGate({ onSuccess, onGoAdmin }: Props) {
  const theme = useResolvedTheme();
  const [email, setEmail] = useState("");
  const [regNo, setRegNo] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const hydrateBootstrap = useMarketStore((s) => s.hydrateBootstrap);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!e.currentTarget.checkValidity()) {
      e.currentTarget.reportValidity();
      return;
    }

    setLoading(true);
    try {
      const loginRes = await apiFetch<any>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          registration_no: regNo.trim(),
        }),
      });
      localStorage.setItem("genesis_token", loginRes.access_token);
      const bootstrap = await apiFetch<any>("/api/v1/bootstrap");
      hydrateBootstrap(bootstrap);
      toast.success(`Welcome to Floor, ${loginRes.user.registration_no}`);
      onSuccess();
    } catch (err: any) {
      const msg = err?.message || "Unable to connect to exchange floor";
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[var(--tv-bg)] text-[var(--tv-text)] flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full max-w-md bg-[var(--tv-surface)] border border-[var(--tv-border)] rounded-2xl p-7 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#2962FF]/15 border border-[#2962FF]/35 flex items-center justify-center text-[#2962FF]">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-[var(--tv-text)]">GENESIS 2026</h1>
              <p className="text-xs text-[var(--tv-muted)] font-medium">VIT Bhopal Trading Terminal</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => toggleColorScheme()}
              aria-label="Toggle color theme"
              className="p-1.5 rounded-lg border border-[var(--tv-border)] hover:bg-[var(--tv-hover)] text-[var(--tv-muted)] hover:text-[var(--tv-text)] transition-colors"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <p className="text-sm text-[var(--tv-muted)] mb-6 leading-relaxed">
          Sign in with your university email and registration number to access your{" "}
          <span className="text-[var(--tv-text)] font-mono font-semibold">₹25,000.00</span> virtual trading wallet.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="student-email"
              className="block text-xs font-semibold uppercase tracking-wider text-[var(--tv-muted)] mb-1.5"
            >
              University Email
            </label>
            <input
              id="student-email"
              name="email"
              type="email"
              required
              spellCheck={false}
              autoComplete="username"
              enterKeyHint="next"
              placeholder="name.regno@vitbhopal.ac.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={errorMsg ? "true" : "false"}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--tv-bg)] border border-[var(--tv-border)] text-sm text-[var(--tv-text)] placeholder-[var(--tv-muted)]/60 focus:outline-none focus:border-[#2962FF] transition-colors"
            />
            <span className="field-error text-xs text-[#F23645] mt-1">
              Enter a valid email address (e.g., student@vitbhopal.ac.in).
            </span>
          </div>

          <div>
            <label
              htmlFor="student-reg"
              className="block text-xs font-semibold uppercase tracking-wider text-[var(--tv-muted)] mb-1.5"
            >
              Registration Number
            </label>
            <input
              id="student-reg"
              name="registration_no"
              type="text"
              required
              minLength={4}
              spellCheck={false}
              autoCapitalize="characters"
              enterKeyHint="done"
              placeholder="25BCE10421"
              value={regNo}
              onChange={(e) => setRegNo(e.target.value.toUpperCase())}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--tv-bg)] border border-[var(--tv-border)] font-mono uppercase text-sm text-[var(--tv-text)] placeholder-[var(--tv-muted)]/60 focus:outline-none focus:border-[#2962FF] transition-colors"
            />
            <span className="field-error text-xs text-[#F23645] mt-1">
              Registration number must be at least 4 characters.
            </span>
          </div>

          {errorMsg && (
            <div
              role="alert"
              aria-live="polite"
              className="p-3 rounded-lg bg-[#F23645]/10 border border-[#F23645]/30 text-xs text-[#F23645]"
            >
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg bg-[#2962FF] hover:bg-[#1E53E5] active:scale-[0.99] disabled:opacity-60 text-white font-semibold text-sm tracking-wide flex items-center justify-center gap-2 transition-all"
          >
            <Zap className="w-4 h-4 fill-current" />
            {loading ? "Authenticating Wallet..." : "Enter Trading Floor"}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-[var(--tv-border)] flex items-center justify-between text-xs text-[var(--tv-muted)]">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#089981]" />
            <span>Port 443 Live · Instant Auto-Sync</span>
          </div>
          <button
            type="button"
            onClick={onGoAdmin}
            className="text-[var(--tv-muted)] hover:text-[var(--tv-text)] underline underline-offset-4 transition-colors"
          >
            Admin Command Desk
          </button>
        </div>
      </div>
    </div>
  );
}
