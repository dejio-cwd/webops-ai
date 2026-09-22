"use client";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./onboarding.module.css";

type Organization = { id: string; name: string; slug: string };
type Membership = { organizations: Organization | null };
export default function OnboardingPage() {
  const router = useRouter(); const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationName, setOrganizationName] = useState(""); const [projectName, setProjectName] = useState(""); const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [step, setStep] = useState(1);
  useEffect(() => { fetch("/api/organizations").then((r) => r.json()).then((data: { memberships?: Membership[] }) => { const list = (data.memberships || []).map((item) => item.organizations).filter((item): item is Organization => Boolean(item)); setOrganizations(list); if (list.length) setStep(2); }).catch(() => null); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      let organization = organizations[0];
      if (!organization) {
        const response = await fetch("/api/organizations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: organizationName }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to create workspace."); organization = data.organization as Organization; setOrganizations([organization]); setStep(2);
      }
      if (!projectName || !domain) { setBusy(false); return; }
      const projectResponse = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: organization.id, name: projectName, domain }) });
      const projectData = await projectResponse.json(); if (!projectResponse.ok) throw new Error(projectData.error || "Unable to create project.");
      router.replace("/workspace"); router.refresh();
    } catch (value) { setError(value instanceof Error ? value.message : "Setup failed."); } finally { setBusy(false); }
  }
  return <main className={styles.page}><section className={styles.shell}><div className={styles.aside}><div className={styles.logo}>W</div><p>WEBOPS AI</p><h1>Build your command center.</h1><span>Secure tenant setup, project governance, and evidence-first audits in one guided flow.</span><div className={styles.steps}><b className={step >= 1 ? styles.active : ""}>01 Workspace</b><b className={step >= 2 ? styles.active : ""}>02 First project</b><b>03 Baseline audit</b></div></div><form className={styles.card} onSubmit={submit}><div className={styles.kicker}>FOUNDATION SETUP</div><h2>{organizations.length ? "Create your first project" : "Create your workspace"}</h2><p>Everything is isolated by organization and protected with role-based access.</p>{!organizations.length && <label>Workspace name<input required value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Acme Web Intelligence" /></label>}<label>Project name<input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Corporate website" /></label><label>Primary domain<input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="example.com" /></label>{error && <div className={styles.error}>{error}</div>}<button disabled={busy}>{busy ? "Creating secure workspace…" : "Create workspace and continue"}</button><small>You can invite teammates and add environments after setup.</small></form></section></main>;
}
