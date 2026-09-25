"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "../sign-in/sign-in.module.css";

export default function ResetPasswordPage() {
  const [accessToken, setAccessToken] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  // Read the browser URL after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { const hash = new URLSearchParams(window.location.hash.slice(1)); setAccessToken(hash.get("access_token") || ""); window.history.replaceState({}, "", "/reset-password"); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (!accessToken) { setError("This recovery link is invalid or expired. Request a new one."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken, password }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Password reset failed.");
      setMessage("Password updated. You can now sign in."); setPassword(""); setConfirm("");
    } catch (value) { setError(value instanceof Error ? value.message : "Password reset failed."); }
    finally { setBusy(false); }
  }
  return <main className={styles.page}><section className={styles.card}><div className={styles.brand}><span>W</span><div><b>WebOps AI</b><small>Evidence intelligence</small></div></div><div className={styles.eyebrow}>SECURE RECOVERY</div><h1>Choose a new password</h1><p className={styles.muted}>Use at least 12 characters and avoid passwords used on other services.</p><form className={styles.form} onSubmit={submit}><label>New password<input type="password" required minLength={12} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>Confirm password<input type="password" required minLength={12} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>{error && <div className={styles.error}>{error}</div>}{message && <div className={styles.success}>{message}</div>}<button className={styles.primary} disabled={busy}>{busy ? "Updating…" : "Update password"}</button></form><Link className={styles.switcher} href="/sign-in">Return to sign in</Link></section></main>;
}
