"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./workspace.module.css";

const modules = [
  "Command Center", "Projects", "Audits", "Crawler", "SEO", "Performance",
  "Assets", "Links", "Accessibility", "Structured Data", "Security",
  "Opportunities", "Fix Center", "AI Studio", "Analytics", "Monitoring",
  "Integrations", "Reports",
];

export default function WorkspacePage() {
  const router = useRouter();
  const [active, setActive] = useState("Command Center");
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (event.key === "Escape") setPaletteOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/sign-in");
    router.refresh();
  }

  function openModule(name: string) {
    setActive(name);
    setPaletteOpen(false);
  }

  return (
    <div className={styles.app}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span>W</span>
          <div><b>WebOps AI</b><small>Command platform</small></div>
        </div>
        <div className={styles.org}>Secure workspace<small>Project setup pending</small></div>
        <nav>
          {modules.map((name) => (
            <button key={name} className={active === name ? styles.selected : ""} onClick={() => setActive(name)}>
              <span>{name}</span>
              {["Monitoring", "Integrations", "Reports"].includes(name) && <em>SOON</em>}
            </button>
          ))}
        </nav>
        <div className={styles.user}>
          <span>W</span>
          <div><b>Authenticated</b><small>Secure session</small></div>
          <button onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <main className={styles.main}>
        <header>
          <div><small>WEBOPS INTELLIGENCE / {active.toUpperCase()}</small><h1>{active}</h1></div>
          <div className={styles.headerActions}>
            <button onClick={() => setPaletteOpen(true)}>⌘ Search</button>
            <button className={styles.primary} onClick={() => router.push("/")}>Run audit</button>
          </div>
        </header>

        {active === "Command Center" ? (
          <>
            <section className={styles.hero}>
              <div>
                <span>PHASE 1 · SECURE FOUNDATION</span>
                <h2>Your evidence command center is online.</h2>
                <p>A governed workspace for technical SEO, performance, accessibility, assets, links, security, fixes, and AI operations.</p>
                <div>
                  <button className={styles.primary} onClick={() => router.push("/")}>Start baseline audit</button>
                  <button onClick={() => setActive("Security")}>Review foundation</button>
                </div>
              </div>
              <div className={styles.orb}><b>01</b><span>foundation active</span></div>
            </section>

            <section className={styles.readiness}>
              {[
                { label: "Identity", value: "Ready", ready: true },
                { label: "Sessions", value: "Protected", ready: true },
                { label: "Tenant", value: "Next", ready: false },
                { label: "Domain", value: "Pending", ready: false },
              ].map((item) => (
                <article key={item.label}>
                  <small>{item.label}</small><b>{item.value}</b>
                  <i className={item.ready ? styles.good : styles.warn} />
                </article>
              ))}
            </section>

            <section className={styles.setup}>
              <div><span>Next production increment</span><h3>Organization and project onboarding</h3><p>The secure shell is deployed first; tenant provisioning and domain verification follow without blocking the audit engine.</p></div>
              <button className={styles.primary} onClick={() => router.push("/onboarding")}>View setup</button>
            </section>

            <section>
              <div className={styles.sectionHead}><div><small>PLATFORM MAP</small><h3>Premium intelligence modules</h3></div><span>{modules.length - 1} capabilities</span></div>
              <div className={styles.moduleGrid}>
                {modules.slice(1).map((name, index) => (
                  <button key={name} onClick={() => setActive(name)}>
                    <span>{String(index + 1).padStart(2, "0")}</span><b>{name}</b>
                    <small>{["Security", "Audits"].includes(name) ? "Foundation active" : "Engine scheduled"}</small>
                  </button>
                ))}
              </div>
            </section>
          </>
        ) : (
          <section className={styles.modulePanel}>
            <div><span>{active.toUpperCase()}</span><h2>{active} workspace</h2><p>This specialist engine will use real evidence, history, permissions, and verification—not fabricated dashboard metrics.</p><button className={styles.primary} onClick={() => setActive("Command Center")}>Return to Command Center</button></div>
          </section>
        )}
      </main>

      {paletteOpen && (
        <div className={styles.overlay} onClick={() => setPaletteOpen(false)}>
          <div className={styles.palette} onClick={(event) => event.stopPropagation()}>
            <input autoFocus placeholder="Jump to a module…" />
            <div>{modules.map((name) => <button key={name} onClick={() => openModule(name)}>{name}<span>Open →</span></button>)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
