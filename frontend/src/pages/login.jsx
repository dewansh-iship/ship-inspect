// frontend/src/pages/login.jsx
import React from "react";
import api from "../api"; // must have withCredentials: true

export default function Login() {
  const [email, setEmail] = React.useState("");
  const [token, setToken] = React.useState(""); // optional JWT pasted from email
  const [otp, setOtp] = React.useState("");     // 6-digit code (works with static OTP too)
  const [status, setStatus] = React.useState({ type: "", msg: "" });
  const [sending, setSending] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);

  const setInfo = (msg) => setStatus({ type: "info", msg });
  const setErr  = (msg) => setStatus({ type: "error", msg });
  const setOk   = (msg) => setStatus({ type: "ok", msg });

  async function sendMagic(e) {
    e.preventDefault();
    setStatus({ type: "", msg: "" });
    if (!email) return setErr("Please enter your email.");
    try {
      setSending(true);
      await api.post("/auth/send", { email });
      setOk("Email sent. Check your inbox. You can also paste the token here or enter the 6-digit code.");
    } catch (err) {
      console.error(err);
      setErr(err?.response?.data?.error || "Failed to send login email");
    } finally {
      setSending(false);
    }
  }

  async function verify(e) {
    e.preventDefault();
    setStatus({ type: "", msg: "" });
    if (!token && (!email || !otp)) {
      return setErr("Paste token OR enter email + 6-digit code.");
    }
    try {
      setVerifying(true);
      await api.post("/auth/verify", {
        email: email || undefined,
        code: otp || undefined,
        token: token || undefined,
      });
      setOk("Signed in! Redirecting…");
      // go to home (or /upload)
      window.location.href = "/";
    } catch (err) {
      console.error(err);
      setErr(err?.response?.data?.error || "Invalid or expired token/code");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-64px)] bg-gradient-to-b from-slate-50 to-white flex items-center justify-center px-4">
      <div className="w-full max-w-xl">
        <div className="bg-white shadow-xl rounded-2xl p-8 border border-slate-200">
          {/* Brand */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
            <p className="text-slate-500 mt-1">
              We’ll email you a magic link. You can also use a 6-digit code (supports your static OTPs).
            </p>
          </div>

          {/* Alerts */}
          {status.msg && (
            <div
              className={
                "mb-5 rounded-lg border px-4 py-3 text-sm " +
                (status.type === "ok"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : status.type === "error"
                  ? "bg-rose-50 border-rose-200 text-rose-800"
                  : "bg-sky-50 border-sky-200 text-sky-800")
              }
            >
              {status.msg}
            </div>
          )}

          {/* Form */}
          <form className="space-y-5" onSubmit={verify}>
            {/* Email + Send */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-center">
              <input
                type="email"
                placeholder="you@company.com"
                className="w-full rounded-xl border border-slate-300 bg-white/70 px-4 py-3 outline-none focus:ring-4 focus:ring-sky-100"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                inputMode="email"
              />
              <button
                type="button"
                onClick={sendMagic}
                disabled={sending || !email}
                className="rounded-xl bg-sky-600 text-white px-5 py-3 font-medium shadow hover:bg-sky-700 disabled:opacity-60"
                title="Send magic link"
              >
                {sending ? "Sending…" : "Send magic link"}
              </button>
            </div>

            {/* Token (optional) */}
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">
                Paste 5-minute token (optional)
              </label>
              <input
                type="text"
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-4 focus:ring-sky-100"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                spellCheck={false}
              />
            </div>

            {/* OR divider */}
            <div className="flex items-center gap-4">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs uppercase tracking-wide text-slate-400">or use code</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            {/* 6-digit code */}
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">
                6-digit code (optional)
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="123456"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 tracking-widest text-center text-lg outline-none focus:ring-4 focus:ring-sky-100"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              />
              <p className="text-xs text-slate-500 mt-1">
                Works with dynamic codes from email and your pre-defined static OTPs.
              </p>
            </div>

            {/* Verify */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={verifying || (!token && !otp)}
                className="w-full rounded-xl bg-neutral-900 text-white px-5 py-3 font-semibold shadow hover:bg-black disabled:opacity-60"
              >
                {verifying ? "Verifying…" : "Verify & Sign in"}
              </button>
            </div>
          </form>

          {/* Footer help */}
          <div className="mt-6 text-xs text-slate-500">
            Trouble receiving mail? Check spam or ask us to whitelist{" "}
            <code className="px-1 py-0.5 rounded bg-slate-100">inspect@ishipplus.cloud</code>.
          </div>
        </div>
      </div>
    </div>
  );
}