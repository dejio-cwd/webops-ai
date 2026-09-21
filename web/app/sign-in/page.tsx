"use client";
import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./sign-in.module.css";

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
  return <main className={styles.page}><section className={styles.card}>
    <div className={styles.brand}><span>W</span><div><b>WebOps AI</b><small>Evidence intelligence</small></div></div>
    <div className={styles.eyebrow}>SECURE WORKSPACE</div><h1>{mode === "login" ? "Welcome back" : "Create your workspace"}</h1>
    <p className={styles.muted}>Sign in to run protected audits, manage projects, and use governed AI connections.</p>
    <form onSubmit={submit} className={styles.form}><label>Email<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input type="password" required minLength={mode === "signup" ? 12 : 8} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error && <div className={styles.error}>{error}</div>}{message && <div className={styles.success}>{message}</div>}
      <button className={styles.primary} disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button></form>
    <button className={styles.switcher} onClick={() => setMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "New to WebOps AI? Create an account" : "Already have an account? Sign in"}</button>
    <div className={styles.trust}><span>Encrypted session</span><span>Tenant isolation</span><span>Evidence-first</span></div>
  </section></main>;
}
