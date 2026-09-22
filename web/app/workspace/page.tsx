"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./workspace.module.css";

type Organization = { id: string; name: string; slug: string };
type Membership = { role: string; organizations: Organization | null };
type Project = { id: string; name: string; domain: string; environment: string; verified_at: string | null; organization_id: string };

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
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/organizations", { cache: "no-store" }),
      fetch("/api/projects", { cache: "no-store" }),
    ]).then(async ([organizationsResponse, projectsResponse]) => {
      if (organizationsResponse.status === 401 || projectsResponse.status === 401) {
        router.replace("/sign-in");
        return;
      }
      const organizationData = await organizationsResponse.json() as { memberships?: Membership[] };
      const projectData = await projectsResponse.json() as { projects?: Project[] };
      const firstOrganization = (organizationData.memberships || []).map((item) => item.organizations).find((item): item is Organization => Boolean(item));
      setOrganization(firstOrganization || null);
      setProjects(projectData.projects || []);
    }).finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setPaletteOpen((open) => !open);
      }
      if (event.key === "Escape") setPaletteOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const activeProject = projects[0];
  const projectTarget = activeProject ? "/?url=" + encodeURIComponent("https://" + activeProject.domain) : "/onboarding";

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/sign-in"); router.refresh();
  }

  function openModule(name: string) { setActive(name); setPaletteOpen(false); }

  if (loading) return <main className={styles.loading}>Preparing your secure command center…</main>;

  return (
    <div className={styles.app}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}><span>W</span><div><b>WebOps AI</b><small>Command platform</small></div></div>
        <div className={styles.org}>{organization?.name || "Workspace setup"}<small>{activeProject ? activeProject.domain : "No active project"}</small></div>
        <nav>{modules.map((name) => <button key={name} className={active === name ? styles.selected : ""} onClick={() => setActive(name)}><span>{name}</span>{["Monitoring", "Integrations", "Reports"].includes(name) && <em>SOON</em>}</button>)}</nav>
        <div className={styles.user}><span>W</span><div><b>Authenticated</b><small>Secure session</small></div><button onClick={signOut}>Sign out</button></div>
      </aside>

      <main className={styles.main}>
        <header><div><small>WEBOPS INTELLIGENCE / {active.toUpperCase()}</small><h1>{active}</h1></div><div className={styles.headerActions}><button onClick={() => setPaletteOpen(true)}>⌘ Search</button><button className={styles.primary} onClick={() => router.push(projectTarget)}>{activeProject ? "Run audit" : "Create project"}</button></div></header>

        {active === "Command Center" ? <>
          <section className={styles.hero}><div><span>PHASE 1 · SECURE FOUNDATION</span><h2>Your evidence command center is online.</h2><p>A governed workspace for technical SEO, performance, accessibility, assets, links, security, fixes, and AI operations.</p><div><button className={styles.primary} onClick={() => router.push(projectTarget)}>{activeProject ? "Start baseline audit" : "Finish workspace setup"}</button><button onClick={() => setActive("Security")}>Review foundation</button></div></div><div className={styles.orb}><b>{String(projects.length).padStart(2, "0")}</b><span>active projects</span></div></section>

          <section className={styles.readiness}>{[
            { label: "Identity", value: "Ready", ready: true },
            { label: "Tenant", value: organization ? "Ready" : "Setup needed", ready: Boolean(organization) },
            { label: "Project", value: activeProject ? "Ready" : "Setup needed", ready: Boolean(activeProject) },
            { label: "Domain", value: activeProject?.verified_at ? "Verified" : "Pending", ready: Boolean(activeProject?.verified_at) },
          ].map((item) => <article key={item.label}><small>{item.label}</small><b>{item.value}</b><i className={item.ready ? styles.good : styles.warn} /></article>)}</section>

          {!activeProject && <section className={styles.setup}><div><span>Action required</span><h3>Create your organization and first project</h3><p>Projects provide the evidence, audit-history, security, and ownership boundary for every scan.</p></div><button className={styles.primary} onClick={() => router.push("/onboarding")}>Start guided setup</button></section>}

          <section><div className={styles.sectionHead}><div><small>PLATFORM MAP</small><h3>Premium intelligence modules</h3></div><span>{modules.length - 1} capabilities</span></div><div className={styles.moduleGrid}>{modules.slice(1).map((name, index) => <button key={name} onClick={() => setActive(name)}><span>{String(index + 1).padStart(2, "0")}</span><b>{name}</b><small>{["Security", "Audits", "Projects"].includes(name) ? "Foundation active" : "Engine scheduled"}</small></button>)}</div></section>
        </> : <section className={styles.modulePanel}><div><span>{active.toUpperCase()}</span><h2>{active} workspace</h2><p>This specialist engine will use real evidence, history, permissions, and verification—not fabricated dashboard metrics.</p><button className={styles.primary} onClick={() => setActive("Command Center")}>Return to Command Center</button></div></section>}
      </main>

      {paletteOpen && <div className={styles.overlay} onClick={() => setPaletteOpen(false)}><div className={styles.palette} onClick={(event) => event.stopPropagation()}><input autoFocus placeholder="Jump to a module…"/><div>{modules.map((name) => <button key={name} onClick={() => openModule(name)}>{name}<span>Open →</span></button>)}</div></div></div>}
    </div>
  );
}
