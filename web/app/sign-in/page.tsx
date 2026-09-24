"use client";
import type { FormEvent } from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./sign-in.module.css";

export default function SignInPage() {
  const router = useRouter(); const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  useEffect(() => { if (new URLSearchParams(window.location.search).get("confirmed") === "1") { setMode("login"); setMessage("Email confirmed. Sign in to continue to your workspace."); window.history.replaceState({}, "", "/sign-in"); } }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Authentication failed.");
      if (mode === "signup" && data.confirmationRequired) { setMode("login"); setPassword(""); setMessage("If this address can be registered, a confirmation email has been sent. Confirm it, then sign in here."); }
      else { router.replace(data.next || "/workspace"); router.refresh(); }
    } catch (value) { setError(value instanceof Error ? value.message : "Authentication failed."); } finally { setBusy(false); }
  }
  function switchMode(){setMode(mode==="login"?"signup":"login");setError("");setMessage("");setPassword("");}
  return <main className={styles.page}><section className={styles.card}><div className={styles.brand}><span>W</span><div><b>WebOps AI</b><small>Evidence intelligence</small></div></div><div className={styles.eyebrow}>SECURE WORKSPACE</div><h1>{mode==="login"?"Welcome back":"Create your workspace"}</h1><p className={styles.muted}>{mode==="login"?"Sign in to continue to protected audits, projects, and governed AI connections.":"Create your secure account. We never reveal whether an address is already registered."}</p><form onSubmit={submit} className={styles.form}><label>Email<input type="email" required autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)}/></label><label>Password<input type="password" required minLength={mode==="signup"?12:8} autoComplete={mode==="login"?"current-password":"new-password"} value={password} onChange={event=>setPassword(event.target.value)}/></label>{mode==="login"&&<Link className={styles.forgot} href="/forgot-password">Forgot password?</Link>}{error&&<div className={styles.error}>{error}</div>}{message&&<div className={styles.success}>{message}</div>}<button className={styles.primary} disabled={busy}>{busy?"Please wait…":mode==="login"?"Sign in":"Create account"}</button></form><button className={styles.switcher} onClick={switchMode}>{mode==="login"?"New to WebOps AI? Create an account":"Already have an account? Sign in"}</button><div className={styles.trust}><span>Encrypted session</span><span>Tenant isolation</span><span>Evidence-first</span></div></section></main>;
}
