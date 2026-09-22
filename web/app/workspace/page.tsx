"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./workspace.module.css";

type Organization = { id: string; name: string; slug: string };
type Membership = { role: string; organizations: Organization | null };
type Project = { id: string; name: string; domain: string; environment: string; verified_at: string | null; organization_id: string };
type Member = { user_id: string; role: string; email: string | null; created_at: string };
type VerificationInstructions = { type?: string; host?: string; value?: string; path?: string; tag?: string };

const modules = ["Command Center", "Projects", "Team & Access", "Audits", "Crawler", "SEO", "Performance", "Assets", "Links", "Accessibility", "Structured Data", "Security", "Opportunities", "Fix Center", "AI Studio", "Analytics", "Monitoring", "Integrations", "Reports"];
const roles = ["owner", "admin", "analyst", "developer", "viewer", "billing"];

async function apiFetch(input: string, init?: RequestInit) {
  let response = await fetch(input, { ...init, cache: "no-store" });
  if (response.status === 401 && !input.includes("/api/auth/")) {
    const refreshed = await fetch("/api/auth/refresh", { method: "POST" });
    if (refreshed.ok) response = await fetch(input, { ...init, cache: "no-store" });
  }
  return response;
}

export default function WorkspacePage() {
  const router = useRouter();
  const [active, setActive] = useState("Command Center"); const [paletteOpen, setPaletteOpen] = useState(false);
  const [organization, setOrganization] = useState<Organization | null>(null); const [projects, setProjects] = useState<Project[]>([]); const [activeProjectId, setActiveProjectId] = useState("");
  const [members, setMembers] = useState<Member[]>([]); const [email, setEmail] = useState(""); const [role, setRole] = useState("viewer");
  const [verificationMethod, setVerificationMethod] = useState("dns"); const [instructions, setInstructions] = useState<VerificationInstructions | null>(null);
  const [userEmail, setUserEmail] = useState(""); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(""); const [error, setError] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  const refreshWorkspace = useCallback(async () => {
    const [sessionResponse, organizationsResponse, projectsResponse] = await Promise.all([apiFetch("/api/auth/session"), apiFetch("/api/organizations"), apiFetch("/api/projects")]);
    if ([sessionResponse, organizationsResponse, projectsResponse].some((response) => response.status === 401)) { router.replace("/sign-in"); return; }
    const sessionData = await sessionResponse.json() as { user?: { email?: string } };
    const organizationData = await organizationsResponse.json() as { memberships?: Membership[] };
    const projectData = await projectsResponse.json() as { projects?: Project[] };
    const firstOrganization = (organizationData.memberships || []).map((item) => item.organizations).find((item): item is Organization => Boolean(item));
    const nextProjects = projectData.projects || [];
    setUserEmail(sessionData.user?.email || ""); setOrganization(firstOrganization || null); setProjects(nextProjects);
    setActiveProjectId((current) => current && nextProjects.some((project) => project.id === current) ? current : nextProjects[0]?.id || "");
  }, [router]);

  const refreshMembers = useCallback(async (organizationId: string) => {
    const response = await apiFetch(`/api/organizations/members?organizationId=${encodeURIComponent(organizationId)}`);
    if (response.ok) { const data = await response.json() as { members?: Member[] }; setMembers(data.members || []); }
  }, []);

  useEffect(() => { refreshWorkspace().catch(() => setError("Unable to load the workspace.")).finally(() => setLoading(false)); }, [refreshWorkspace]);
  useEffect(() => { if (organization) refreshMembers(organization.id).catch(() => null); }, [organization, refreshMembers]);
  useEffect(() => { const stored = window.localStorage.getItem("webops-theme"); if (stored === "light") setTheme("light"); }, []);
  useEffect(() => { function onKeyDown(event: KeyboardEvent) { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen((open) => !open); } if (event.key === "Escape") setPaletteOpen(false); } window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, []);

  const activeProject = projects.find((project) => project.id === activeProjectId) || projects[0];
  const projectTarget = activeProject ? "/?url=" + encodeURIComponent("https://" + activeProject.domain) : "/onboarding";
  function clearMessages() { setError(""); setNotice(""); }
  function toggleTheme() { const next = theme === "dark" ? "light" : "dark"; setTheme(next); window.localStorage.setItem("webops-theme", next); }
  async function signOut() { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/sign-in"); router.refresh(); }
  function openModule(name: string) {
    setPaletteOpen(false); clearMessages();
    if (name === "AI Studio") { router.push("/ai-studio"); return; }
    setActive(name);
  }

  async function addMember() {
    if (!organization) return; setBusy(true); clearMessages();
    const response = await apiFetch("/api/organizations/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: organization.id, email, role }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) setError(data.error || "Unable to add member."); else { setEmail(""); setNotice("Workspace member added."); await refreshMembers(organization.id); }
    setBusy(false);
  }
  async function changeRole(userId: string, nextRole: string) {
    if (!organization) return; setBusy(true); clearMessages();
    const response = await apiFetch("/api/organizations/members", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: organization.id, userId, role: nextRole }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) setError(data.error || "Unable to update role."); else { setNotice("Member role updated."); await refreshMembers(organization.id); }
    setBusy(false);
  }
  async function removeMember(userId: string) {
    if (!organization) return; setBusy(true); clearMessages();
    const response = await apiFetch("/api/organizations/members", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: organization.id, userId }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) setError(data.error || "Unable to remove member."); else { setNotice("Member removed."); await refreshMembers(organization.id); }
    setBusy(false);
  }
  async function startVerification() {
    if (!activeProject) return; setBusy(true); clearMessages();
    const response = await apiFetch("/api/domain-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: activeProject.id, action: "start", method: verificationMethod }) });
    const data = await response.json() as { instructions?: VerificationInstructions; error?: string };
    if (!response.ok) setError(data.error || "Unable to start verification."); else { setInstructions(data.instructions || null); setNotice("Verification challenge created."); }
    setBusy(false);
  }
  async function checkVerification() {
    if (!activeProject) return; setBusy(true); clearMessages();
    const response = await apiFetch("/api/domain-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: activeProject.id, action: "verify", method: verificationMethod }) });
    const data = await response.json() as { verified?: boolean; error?: string };
    if (!response.ok || !data.verified) setError(data.error || "Verification token was not found."); else { setNotice("Domain ownership verified."); setInstructions(null); await refreshWorkspace(); }
    setBusy(false);
  }

  if (loading) return <main className={styles.loading}>Preparing your secure command center…</main>;

  const projectsPanel = <section className={styles.console}><div className={styles.consoleHead}><div><span>PROJECT GOVERNANCE</span><h2>Projects and environments</h2><p>Keep crawl targets, environments, and ownership verification inside a governed tenant boundary.</p></div><button className={styles.primary} onClick={() => router.push("/onboarding")}>Add project</button></div>{projects.length ? <><div className={styles.projectPicker}>{projects.map((project) => <button key={project.id} className={activeProject?.id === project.id ? styles.projectActive : ""} onClick={() => setActiveProjectId(project.id)}><b>{project.name}</b><span>{project.domain}</span><small>{project.environment} · {project.verified_at ? "verified" : "verification pending"}</small></button>)}</div>{activeProject && <div className={styles.verifyBox}><div><span>DOMAIN OWNERSHIP</span><h3>{activeProject.domain}</h3><p>Verification unlocks governed fixes, monitoring, and higher-trust automation.</p></div><div className={styles.inlineForm}><select value={verificationMethod} onChange={(event) => setVerificationMethod(event.target.value)}><option value="dns">DNS TXT</option><option value="file">Well-known file</option><option value="meta">Meta tag</option></select><button onClick={startVerification} disabled={busy}>Create challenge</button><button className={styles.primary} onClick={checkVerification} disabled={busy}>Check verification</button></div>{instructions && <pre className={styles.instructions}>{JSON.stringify(instructions, null, 2)}</pre>}</div>}</> : <div className={styles.emptyState}><h3>No projects yet</h3><p>Create the first governed website project to begin collecting evidence.</p><button className={styles.primary} onClick={() => router.push("/onboarding")}>Create project</button></div>}</section>;

  const teamPanel = <section className={styles.console}><div className={styles.consoleHead}><div><span>ROLE-BASED ACCESS</span><h2>Team and permissions</h2><p>Owners and admins can add existing WebOps AI accounts and assign least-privilege roles.</p></div></div>{organization ? <><div className={styles.inlineForm}><input type="email" placeholder="teammate@company.com" value={email} onChange={(event) => setEmail(event.target.value)} /><select value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((name) => <option key={name}>{name}</option>)}</select><button className={styles.primary} onClick={addMember} disabled={busy || !email}>Add member</button></div><div className={styles.memberList}>{members.map((member) => <article key={member.user_id}><div><b>{member.email || member.user_id}</b><small>Added {new Date(member.created_at).toLocaleDateString()}</small></div><select value={member.role} onChange={(event) => changeRole(member.user_id, event.target.value)} disabled={busy}>{roles.map((name) => <option key={name}>{name}</option>)}</select><button onClick={() => removeMember(member.user_id)} disabled={busy}>Remove</button></article>)}</div></> : <div className={styles.emptyState}><p>Create a workspace before managing access.</p></div>}</section>;

  const securityPanel = <section className={styles.console}><div className={styles.consoleHead}><div><span>SECURITY POSTURE</span><h2>Production foundation controls</h2><p>Controls are enforced server-side and designed to fail closed.</p></div></div><div className={styles.controlGrid}>{["HttpOnly cookie sessions","Refresh-token rotation","Tenant isolation","Role-based access","SSRF and redirect protection","Origin enforcement","Request-size limits","Domain ownership verification","BYOK browser-secret removal","Security and privacy headers"].map((control) => <article key={control}><i className={styles.good}/><b>{control}</b><span>Active</span></article>)}</div></section>;

  const evidenceTarget = activeProject ? `/?url=${encodeURIComponent("https://" + activeProject.domain)}&module=${encodeURIComponent(active === "Audits" || active === "Crawler" ? "Crawl" : active === "Opportunities" || active === "Fix Center" ? "Opportunities" : active === "Performance" ? "Performance" : active === "Links" || active === "Assets" ? "Links & Images" : "Overview")}` : "/onboarding";
  const specialistActions: Record<string, { title: string; description: string; action: string }> = {
    Audits: { title: "Run a governed baseline audit", description: "Crawl the active project, capture page evidence, and run deterministic SEO, content, link, image, and accessibility rules.", action: "Open audit workbench" },
    Crawler: { title: "Configure and run the crawler", description: "Choose crawl depth, page ceiling, concurrency, robots behavior, and external-link checks before collecting evidence.", action: "Open crawler" },
    SEO: { title: "Inspect SEO evidence", description: "Review titles, descriptions, headings, canonicals, indexability, status codes, and structured findings from a real crawl.", action: "Open SEO evidence" },
    Performance: { title: "Measure performance", description: "Run the audit first, then use the performance workspace for the active origin and its measured page-speed results.", action: "Open performance" },
    Assets: { title: "Review asset evidence", description: "Inspect image and media references captured from crawled pages, including missing metadata and oversized assets.", action: "Open asset evidence" },
    Links: { title: "Review link intelligence", description: "Inspect internal and external links, broken targets, redirects, and representative evidence from the crawl.", action: "Open link evidence" },
    Accessibility: { title: "Review accessibility findings", description: "Use deterministic page evidence to identify missing labels, headings, image alternatives, and related accessibility signals.", action: "Open findings" },
    "Structured Data": { title: "Review structured-data evidence", description: "Inspect structured-data signals and pages where schema evidence is missing or malformed.", action: "Open findings" },
    Security: { title: "Review security controls", description: "Security controls are active server-side. Run a baseline audit to inspect evidence and use this workspace for tenancy and verification controls.", action: "Review security posture" },
    Analytics: { title: "Build an evidence baseline", description: "Analytics views are grounded in measured crawl history. Run a baseline audit to create the first evidence set.", action: "Create baseline" },
    Monitoring: { title: "Prepare regression monitoring", description: "Monitoring requires a verified project and a baseline audit. Start by collecting the first evidence snapshot.", action: "Create baseline" },
    Integrations: { title: "Configure governed AI", description: "Provider credentials, model allowlists, scopes, testing, rotation, and revocation are managed in AI Studio.", action: "Open AI Studio" },
    Reports: { title: "Generate an evidence report", description: "Reports must be generated from a completed audit. Open the audit workbench to collect the source evidence first.", action: "Open audit workbench" },
  };
  const specialist = specialistActions[active];
  const specialistPanel = specialist ? <section className={styles.modulePanel}><div><span>{active.toUpperCase()}</span><h2>{specialist.title}</h2><p>{specialist.description}</p><div className={styles.inlineForm}><button className={styles.primary} onClick={() => active === "Integrations" ? router.push("/ai-studio") : router.push(evidenceTarget)}>{specialist.action}</button><button onClick={() => setActive("Projects")}>Manage project</button><button onClick={() => setActive("Command Center")}>Return to Command Center</button></div>{!activeProject && <div className={styles.emptyState}><h3>Create a project first</h3><p>This module stays evidence-first and will not display invented metrics.</p><button className={styles.primary} onClick={() => router.push("/onboarding")}>Create project</button></div>}</div></section> : null;

  return <div className={`${styles.app} ${theme === "light" ? styles.light : ""}`}><aside className={styles.sidebar}><div className={styles.brand}><span>W</span><div><b>WebOps AI</b><small>Command platform</small></div></div><div className={styles.org}>{organization?.name || "Workspace setup"}<small>{activeProject ? activeProject.domain : "No active project"}</small>{projects.length > 1 && <select value={activeProjectId} onChange={(event) => setActiveProjectId(event.target.value)}>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select>}</div><nav>{modules.map((name) => <button key={name} className={active === name ? styles.selected : ""} onClick={() => openModule(name)}><span>{name}</span></button>)}</nav><div className={styles.user}><span>{userEmail.slice(0,1).toUpperCase() || "W"}</span><div><b>{userEmail || "Authenticated"}</b><small>Secure session</small></div><button onClick={signOut}>Sign out</button></div></aside><main className={styles.main}><header><div><small>WEBOPS INTELLIGENCE / {active.toUpperCase()}</small><h1>{active}</h1></div><div className={styles.headerActions}><button onClick={toggleTheme}>{theme === "dark" ? "☀ Light" : "◐ Dark"}</button><button onClick={() => setPaletteOpen(true)}>⌘ Search</button><button className={styles.primary} onClick={() => router.push(projectTarget)}>{activeProject ? "Run audit" : "Create project"}</button></div></header>{error && <div className={styles.alertError}>{error}</div>}{notice && <div className={styles.alertSuccess}>{notice}</div>}{active === "Command Center" ? <><section className={styles.hero}><div><span>PHASE 1 · SECURE FOUNDATION</span><h2>Your evidence command center is online.</h2><p>A governed workspace for technical SEO, performance, accessibility, assets, links, security, fixes, and AI operations.</p><div><button className={styles.primary} onClick={() => router.push(projectTarget)}>{activeProject ? "Start baseline audit" : "Finish workspace setup"}</button><button onClick={() => setActive("Security")}>Review foundation</button></div></div><div className={styles.orb}><b>{String(projects.length).padStart(2, "0")}</b><span>active projects</span></div></section><section className={styles.readiness}>{[{ label: "Identity", value: "Ready", ready: true },{ label: "Tenant", value: organization ? "Ready" : "Setup needed", ready: Boolean(organization) },{ label: "Project", value: activeProject ? "Ready" : "Setup needed", ready: Boolean(activeProject) },{ label: "Domain", value: activeProject?.verified_at ? "Verified" : "Pending", ready: Boolean(activeProject?.verified_at) }].map((item) => <article key={item.label}><small>{item.label}</small><b>{item.value}</b><i className={item.ready ? styles.good : styles.warn}/></article>)}</section>{!activeProject && <section className={styles.setup}><div><span>Action required</span><h3>Create your organization and first project</h3><p>Projects provide the evidence, audit-history, security, and ownership boundary for every scan.</p></div><button className={styles.primary} onClick={() => router.push("/onboarding")}>Start guided setup</button></section>}<section><div className={styles.sectionHead}><div><small>PLATFORM MAP</small><h3>Premium intelligence modules</h3></div><span>{modules.length - 1} capabilities</span></div><div className={styles.moduleGrid}>{modules.slice(1).map((name, index) => <button key={name} onClick={() => openModule(name)}><span>{String(index + 1).padStart(2, "0")}</span><b>{name}</b><small>{["Security","Audits","Projects","Team & Access"].includes(name) ? "Foundation active" : "Engine scheduled"}</small></button>)}</div></section></> : active === "Projects" ? projectsPanel : active === "Team & Access" ? teamPanel : active === "Security" ? securityPanel : {specialistPanel}}</main>{paletteOpen && <div className={styles.overlay} onClick={() => setPaletteOpen(false)}><div className={styles.palette} onClick={(event) => event.stopPropagation()}><input autoFocus placeholder="Jump to a module…"/><div>{modules.map((name) => <button key={name} onClick={() => openModule(name)}>{name}<span>Open →</span></button>)}</div></div></div>}</div>;
}
