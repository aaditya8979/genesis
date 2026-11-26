import { FormEvent, useState } from "react";
import { ShieldCheck, TrendingUp, Zap } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "../lib/gateway";
import { useMarketStore } from "../store/useMarketStore";

interface Props {
  onSuccess: () => void;
  onGoAdmin: () => void;
}

export function LoginGate({ onSuccess, onGoAdmin }: Props) {
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
    <div className="min-h-[100dvh] bg-[#0B0E14] text-[#F3F5F8] flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full max-w-md bg-[#121721] border border-[#232B3A] rounded-2xl p-7 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#00D09C]/15 border border-[#00D09C]/40 flex items-center justify-center text-[#00D09C]">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white">GENESIS 2026</h1>
              <p className="text-xs text-[#8A94A6] font-medium">VIT Bhopal Institutional Exchange</p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold bg-[#00D09C]/10 text-[#00D09C] border border-[#00D09C]/25">
            PORT 443 LIVE
          </span>
        </div>

        <p className="text-sm text-[#8A94A6] mb-6 leading-relaxed">
          Enter your university email and registration number to initialize your{" "}
          <span className="text-white font-mono font-semibold">₹25,000.00</span> virtual capital wallet.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="student-email" className="block text-xs font-semibold uppercase tracking-wider text-[#8A94A6] mb-1.5">
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
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0E14] border border-[#232B3A] text-sm text-white placeholder-[#505B6F] focus:outline-none focus:border-[#00D09C] transition-colors"
            />
            <span className="field-error text-xs text-[#EB5B3C] mt-1">
              Enter a valid email address (e.g., student@vitbhopal.ac.in).
            </span>
          </div>

          <div>
            <label htmlFor="student-reg" className="block text-xs font-semibold uppercase tracking-wider text-[#8A94A6] mb-1.5">
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
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0E14] border border-[#232B3A] font-mono uppercase text-sm text-white placeholder-[#505B6F] focus:outline-none focus:border-[#00D09C] transition-colors"
            />
            <span className="field-error text-xs text-[#EB5B3C] mt-1">
              Registration number must be at least 4 characters.
            </span>
          </div>

          {errorMsg && (
            <div role="alert" aria-live="polite" className="p-3 rounded-lg bg-[#EB5B3C]/10 border border-[#EB5B3C]/30 text-xs text-[#EB5B3C]">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg bg-[#00D09C] hover:bg-[#00B889] active:scale-[0.99] disabled:opacity-60 text-[#0B0E14] font-bold text-sm tracking-wide flex items-center justify-center gap-2 transition-all"
          >
            <Zap className="w-4 h-4 fill-current" />
            {loading ? "Authenticating Wallet..." : "Enter Trading Floor"}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-[#232B3A] flex items-center justify-between text-xs text-[#8A94A6]">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#00D09C]" />
            <span>Instant Auto-Sync</span>
          </div>
          <button
            type="button"
            onClick={onGoAdmin}
            className="text-[#8A94A6] hover:text-white underline underline-offset-4 transition-colors"
          >
            Admin Command Desk
          </button>
        </div>
      </div>
    </div>
  );
}

