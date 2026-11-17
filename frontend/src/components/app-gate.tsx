"use client";

import { FormEvent, useState } from "react";
import { AlertTriangle, LoaderCircle, ShieldCheck } from "lucide-react";
import { ApiError, errorMessage } from "@/lib/api/client";
import { useApi, useApiContext } from "@/lib/api/provider";

export function AppGate({ children }: { children: React.ReactNode }) {
  const { phase, backendError, retry, onLoggedIn } = useApiContext();
  const api = useApi();
  const [email, setEmail] = useState("owner@example.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLoggedIn(await api.login(email.trim(), password));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (phase === "checking") {
    return (
      <div className="empty" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <LoaderCircle className="spin" size={28} />
        <strong style={{ display: "block", marginTop: 12, color: "var(--text)" }}>Connecting to the live backend…</strong>
      </div>
    );
  }

  if (phase === "backend_down") {
    return (
      <div className="empty" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <AlertTriangle size={28} />
        <strong style={{ display: "block", marginTop: 12, color: "var(--text)" }}>Backend is not reachable</strong>
        <p>Start Docker (Hermes + API) then retry. Demo Mode is disabled.</p>
        <p className="secondary">{backendError}</p>
        <button className="btn primary" style={{ marginTop: 16 }} onClick={retry}>
          Retry connection
        </button>
      </div>
    );
  }

  if (phase === "unauthenticated") {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <form className="card pad" style={{ width: "min(420px, 100%)" }} onSubmit={submit}>
          <div className="brand" style={{ padding: "0 0 18px" }}>
            <div className="brand-mark">
              <ShieldCheck size={20} />
            </div>
            <div>
              <strong>Nexa Sales AI</strong>
              <small>Live owner sign-in</small>
            </div>
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && (
            <div className="notice danger" style={{ marginTop: 14 }}>
              {error}
            </div>
          )}
          <button className="btn primary" type="submit" disabled={busy} style={{ width: "100%", marginTop: 16 }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}
