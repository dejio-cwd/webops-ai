"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./onboarding.module.css";

type Organization = { id: string; name: string; slug: string };
type Membership = { role: string; organizations: Organization | null };

export default function OnboardingPage() {
  const router = useRouter();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/organizations", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) { router.replace("/sign-in"); return; }
        const data = await response.json() as { memberships?: Membership[] };
        const first = (data.memberships || []).map((item) => item.organizations).find((item): item is Organization => Boolean(item));
        if (first) setOrganization(first);
      })
      .catch(() => setError("Unable to load workspace status."))
      .finally(() => setLoading(false));
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      let currentOrganization = organization;
      if (!currentOrganization) {
        const organizationResponse = await fetch("/api/organizations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: organizationName }) });
        const organizationData = await organizationResponse.json() as { organization?: Organization; error?: string };
        if (!organizationResponse.ok || !organizationData.organization) throw new Error(organizationData.error || "Unable to create workspace.");
        currentOrganization = organizationData.organization;
        setOrganization(currentOrganization);
      }
      const projectResponse = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: currentOrganization.id, name: projectName, domain, environment: "production" }) });
      const projectData = await projectResponse.json() as { error?: string };
      if (!projectResponse.ok) throw new Error(projectData.error || "Unable to create project.");
      router.replace("/workspace"); router.refresh();
    } catch (value) { setError(value instanceof Error ? value.message : "Setup failed."); }
    finally { setBusy(false); }
  }

  if (loading) return <main className={styles.page}>Preparing secure onboarding…</main>;
  return <main className={styles.page}><section className={styles.shell}><div className={styles.aside}><div className={styles.logo}>W</div><p>WEBOPS AI</p><h1>Build your command center.</h1><span>Secure tenant setup, project governance, and evidence-first audits in one guided flow.</span><div className={styles.steps}><b className={styles.active}>01 Identity secured</b><b className={organization ? styles.active : ""}>02 Workspace</b><b>03 Baseline audit</b></div></div><form className={styles.card} onSubmit={submit}><div className={styles.kicker}>FOUNDATION SETUP</div><h2>{organization ? "Create your first project" : "Create your workspace"}</h2><p>Everything is isolated by organization and protected with role-based access.</p>{!organization && <label>Workspace name<input required value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Acme Web Intelligence" /></label>}<label>Project name<input required value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Corporate website" /></label><label>Primary domain<input required value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="example.com" /></label>{error && <div className={styles.error}>{error}</div>}<button disabled={busy}>{busy ? "Creating secure workspace…" : "Create and continue"}</button><small>You can add teammates and environments after setup.</small></form></section></main>;
}
