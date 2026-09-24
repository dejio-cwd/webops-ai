"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { useState } from "react";
import styles from "../sign-in/sign-in.module.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/recover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Recovery request failed.");
      setMessage(data.message || "If an account exists, a recovery email has been sent.");
    } catch (value) { setError(value instanceof Error ? value.message : "Recovery request failed."); }
    finally { setBusy(false); }
  }
  return <main className={styles.page}><section className={styles.card}><div className={styles.brand}><span>W</span><div><b>WebOps AI</b><small>Evidence intelligence</small></div></div><div className={styles.eyebrow}>ACCOUNT RECOVERY</div><h1>Reset your password</h1><p className={styles.muted}>Enter your account email. For privacy, the response is the same whether or not the account exists.</p><form className={styles.form} onSubmit={submit}><label>Email<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>{error && <div className={styles.error}>{error}</div>}{message && <div className={styles.success}>{message}</div>}<button className={styles.primary} disabled={busy}>{busy ? "Sending…" : "Send recovery email"}</button></form><Link className={styles.switcher} href="/sign-in">Return to sign in</Link></section></main>;
}
