"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function SignInPage() {
  const router = useRouter(); const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Authentication failed.");
      if (mode === "signup" && data.confirmationRequired) setMessage("Check your email to confirm your account, then sign in.");
      else { router.replace("/"); router.refresh(); }
    } catch (value) { setError(value instanceof Error ? value.message : "Authentication failed."); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><section className="auth-card">
    <div className="auth-brand"><span>W</span><div><b>WebOps AI</b><small>Evidence intelligence</small></div></div>
    <div className="eyebrow">SECURE WORKSPACE</div><h1>{mode === "login" ? "Welcome back" : "Create your workspace"}</h1>
    <p className="muted">Sign in to run protected audits, manage projects, and use governed AI connections.</p>
    <form onSubmit={submit} className="auth-form"><label>Email<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input type="password" required minLength={mode === "signup" ? 12 : 8} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error && <div className="notice bad">{error}</div>}{message && <div className="notice ok">{message}</div>}
      <button className="btn" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button></form>
    <button className="auth-switch" onClick={() => setMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "New to WebOps AI? Create an account" : "Already have an account? Sign in"}</button>
  </section></main>;
}
