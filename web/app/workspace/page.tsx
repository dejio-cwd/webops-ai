"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./workspace.module.css";

type Organization = { id: string; name: string; slug: string };
type Membership = { role: string; organizations: Organization | null };
type Project = {
  id: string;
  name: string;
  domain: string;
  environment: string;
  verified_at: string | null;
  organization_id: string;
};
type Member = {
  user_id: string;
  role: string;
  email: string | null;
  created_at: string;
};
type Invitation = {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};
type VerificationInstructions = {
  type?: string;
  host?: string;
  value?: string;
  path?: string;
  tag?: string;
};

const modules = [
  "Command Center",
  "Projects",
  "Team & Access",
  "Audits",
  "Crawler",
  "SEO",
  "Performance",
  "Assets",
  "Links",
  "Accessibility",
  "Structured Data",
  "Security",
  "Opportunities",
  "Fix Center",
  "AI Studio",
  "Analytics",
  "Monitoring",
  "Integrations",
  "Reports",
];
const roles = ["owner", "admin", "analyst", "developer", "viewer", "billing"];

async function apiFetch(input: string, init?: RequestInit) {
  let response = await fetch(input, { ...init, cache: "no-store" });
  if (response.status === 401 && !input.includes("/api/auth/")) {
    const refreshed = await fetch("/api/auth/refresh", { method: "POST" });
    if (refreshed.ok)
      response = await fetch(input, { ...init, cache: "no-store" });
  }
  return response;
}

export default function WorkspacePage() {
  const router = useRouter();
  const [active, setActive] = useState("Command Center");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [invitationLink, setInvitationLink] = useState("");
  const [verificationMethod, setVerificationMethod] = useState("dns");
  const [instructions, setInstructions] =
    useState<VerificationInstructions | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [monitorCadence, setMonitorCadence] = useState<"daily" | "weekly">(
    "weekly",
  );
  const [monitorEnabled, setMonitorEnabled] = useState(true);
  const [monitorStatus, setMonitorStatus] = useState("");
  const [monitorAlerts, setMonitorAlerts] = useState<
    Array<{
      id: string;
      severity: string;
      summary: { regressions?: number; healthScoreDelta?: number };
      status: string;
      created_at: string;
    }>
  >([]);

  const refreshWorkspace = useCallback(async () => {
    const [sessionResponse, organizationsResponse, projectsResponse] =
      await Promise.all([
        apiFetch("/api/auth/session"),
        apiFetch("/api/organizations"),
        apiFetch("/api/projects"),
      ]);
    if (
      [sessionResponse, organizationsResponse, projectsResponse].some(
        (response) => response.status === 401,
      )
    ) {
      router.replace("/sign-in");
      return;
    }
    const sessionData = (await sessionResponse.json()) as {
      user?: { email?: string };
    };
    const organizationData = (await organizationsResponse.json()) as {
      memberships?: Membership[];
    };
    const projectData = (await projectsResponse.json()) as {
      projects?: Project[];
    };
    const availableOrganizations = (organizationData.memberships || [])
      .map((item) => item.organizations)
      .filter((item): item is Organization => Boolean(item));
    const firstOrganization = availableOrganizations[0];
    const nextProjects = projectData.projects || [];
    const selectedOrganization =
      availableOrganizations.find((item) => item.id === organization?.id) ||
      firstOrganization;
    const visibleProjects = selectedOrganization
      ? nextProjects.filter(
          (project) => project.organization_id === selectedOrganization.id,
        )
      : nextProjects;
    setUserEmail(sessionData.user?.email || "");
    setOrganizations(availableOrganizations);
    setOrganization(selectedOrganization || null);
    setProjects(nextProjects);
    setActiveProjectId((current) =>
      current && visibleProjects.some((project) => project.id === current)
        ? current
        : visibleProjects[0]?.id || "",
    );
  }, [router]);

  const refreshMembers = useCallback(async (organizationId: string) => {
    const response = await apiFetch(
      `/api/organizations/members?organizationId=${encodeURIComponent(organizationId)}`,
    );
    if (response.ok) {
      const data = (await response.json()) as { members?: Member[] };
      setMembers(data.members || []);
    }
  }, []);

  const refreshInvitations = useCallback(async (organizationId: string) => {
    const response = await apiFetch(
      `/api/organizations/invitations?organizationId=${encodeURIComponent(organizationId)}`,
    );
    if (response.ok) {
      const data = (await response.json()) as { invitations?: Invitation[] };
      setInvitations(data.invitations || []);
    }
  }, []);

  useEffect(() => {
    refreshWorkspace()
      .catch(() => setError("Unable to load the workspace."))
      .finally(() => setLoading(false));
  }, [refreshWorkspace]);
  useEffect(() => {
    if (organization) {
      refreshMembers(organization.id).catch(() => null);
      refreshInvitations(organization.id).catch(() => null);
    }
  }, [organization, refreshMembers, refreshInvitations]);

  useEffect(() => {
    const stored = window.localStorage.getItem("webops-theme");
    if (stored === "light") setTheme("light");
  }, []);
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

  const visibleProjects = organization
    ? projects.filter((project) => project.organization_id === organization.id)
    : projects;
  const activeProject =
    visibleProjects.find((project) => project.id === activeProjectId) ||
    visibleProjects[0];
  // Reload persisted monitoring state whenever the active tenant project changes.
  // Default form values are only used when no configuration exists yet.
  useEffect(() => {
    const projectId = activeProject?.id;
    let cancelled = false;
    setMonitorCadence("weekly");
    setMonitorEnabled(false);
    setMonitorStatus("");
    setMonitorAlerts([]);
    if (!projectId) return () => { cancelled = true; };
    Promise.all([
      apiFetch(`/api/monitoring?projectId=${encodeURIComponent(projectId)}`),
      apiFetch(`/api/monitoring/alerts?projectId=${encodeURIComponent(projectId)}`),
    ]).then(async ([monitorResponse, alertResponse]) => {
      if (cancelled) return;
      if (monitorResponse.ok) {
        const data = (await monitorResponse.json()) as { monitors?: Array<{ cadence: "daily" | "weekly"; enabled: boolean; next_run_at: string | null }> };
        const monitor = data.monitors?.[0];
        if (monitor && !cancelled) {
          setMonitorCadence(monitor.cadence);
          setMonitorEnabled(monitor.enabled);
          setMonitorStatus(monitor.enabled && monitor.next_run_at
            ? `Next scheduled run: ${new Date(monitor.next_run_at).toLocaleString()}`
            : "Monitoring paused.");
        }
      }
      if (alertResponse.ok) {
        const data = (await alertResponse.json()) as { alerts?: typeof monitorAlerts };
        if (!cancelled) setMonitorAlerts(data.alerts || []);
      }
    }).catch(() => { if (!cancelled) setMonitorStatus("Unable to load monitoring settings."); });
    return () => { cancelled = true; };
  }, [activeProject?.id]);
  const projectTarget = activeProject
    ? `/audit?url=${encodeURIComponent("https://" + activeProject.domain)}&projectId=${encodeURIComponent(activeProject.id)}&environment=${encodeURIComponent(activeProject.environment)}`
    : "/onboarding";
  function clearMessages() {
    setError("");
    setNotice("");
  }
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    window.localStorage.setItem("webops-theme", next);
  }
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/sign-in");
    router.refresh();
  }
  function openModule(name: string) {
    if (name === "AI Studio") {
      router.push("/ai-studio");
      return;
    }
    setActive(name);
    setPaletteOpen(false);
    clearMessages();
  }

  async function addMember() {
    if (!organization) return;
    setBusy(true);
    clearMessages();
    const response = await apiFetch("/api/organizations/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: organization.id, email, role }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) setError(data.error || "Unable to add member.");
    else {
      setEmail("");
      setNotice("Workspace member added.");
      await refreshMembers(organization.id);
    }
    setBusy(false);
  }
  async function createInvitation() {
    if (!organization || !email) return;
    setBusy(true);
    clearMessages();
    setInvitationLink("");
    const response = await apiFetch("/api/organizations/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: organization.id, email, role }),
    });
    const data = (await response.json()) as {
      acceptPath?: string;
      error?: string;
    };
    if (!response.ok) setError(data.error || "Unable to create invitation.");
    else {
      setInvitationLink(`${window.location.origin}${data.acceptPath || ""}`);
      setNotice(
        "Invitation created. Copy the link and send it securely to the invited person.",
      );
    }
    setBusy(false);
  }
  async function revokeInvitation(invitationId: string) {
    if (
      !organization ||
      !window.confirm("Revoke this invitation? The link will stop working.")
    )
      return;
    setBusy(true);
    clearMessages();
    const response = await apiFetch("/api/organizations/invitations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: organization.id, invitationId }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) setError(data.error || "Unable to revoke invitation.");
    else {
      setNotice("Invitation revoked.");
      await refreshInvitations(organization.id);
    }
    setBusy(false);
  }
  async function changeRole(userId: string, nextRole: string) {
    if (!organization) return;
    setBusy(true);
    clearMessages();
    const response = await apiFetch("/api/organizations/members", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: organization.id,
        userId,
        role: nextRole,
      }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) setError(data.error || "Unable to update role.");
    else {
      setNotice("Member role updated.");
      await refreshMembers(organization.id);
    }
    setBusy(false);
  }
  async function removeMember(userId: string) {
    if (!organization) return;
    setBusy(true);
    clearMessages();
    const response = await apiFetch("/api/organizations/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: organization.id, userId }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) setError(data.error || "Unable to remove member.");
    else {
      setNotice("Member removed.");
      await refreshMembers(organization.id);
    }
    setBusy(false);
  }
  async function updateEnvironment(projectId: string, environment: string) {
    if (!organization) return;
    setBusy(true);
    clearMessages();
    const response = await apiFetch("/api/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        organizationId: organization.id,
        environment,
      }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok)
      setError(data.error || "Unable to update project environment.");
    else {
      setNotice(`Environment changed to ${environment}.`);
      await refreshWorkspace();
    }
    setBusy(false);
  }
  async function deleteProject(projectId: string) {
    if (
      !organization ||
      !window.confirm(
        "Delete this project and its verification records? This cannot be undone.",
      )
    )
      return;
    setBusy(true);
    clearMessages();
    const response = await apiFetch("/api/projects", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, organizationId: organization.id }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) setError(data.error || "Unable to delete project.");
    else {
      setNotice("Project deleted.");
      await refreshWorkspace();
    }
    setBusy(false);
  }
  async function startVerification() {
    if (!activeProject) return;
    setBusy(true);
    clearMessages();
    const response = await apiFetch("/api/domain-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: activeProject.id,
        action: "start",
        method: verificationMethod,
      }),
    });
    const data = (await response.json()) as {
      instructions?: VerificationInstructions;
      error?: string;
    };
    if (!response.ok) setError(data.error || "Unable to start verification.");
    else {
      setInstructions(data.instructions || null);
      setNotice("Verification challenge created.");
    }
    setBusy(false);
  }
  async function loadMonitoringAlerts() {
    if (!activeProject) return;
    const response = await apiFetch(
      `/api/monitoring/alerts?projectId=${encodeURIComponent(activeProject.id)}`,
    );
    if (response.ok) {
      const data = (await response.json()) as { alerts?: typeof monitorAlerts };
      setMonitorAlerts(data.alerts || []);
    }
  }
  async function updateMonitoringAlert(
    alertId: string,
    status: "acknowledged" | "resolved",
  ) {
    const response = await apiFetch("/api/monitoring/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId, status }),
    });
    if (response.ok) {
      setNotice(`Monitoring alert ${status}.`);
      await loadMonitoringAlerts();
    }
  }

  async function saveMonitoring() {
    if (!activeProject) return;
    setBusy(true);
    clearMessages();
    const response = await apiFetch("/api/monitoring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: activeProject.id,
        cadence: monitorCadence,
        enabled: monitorEnabled,
      }),
    });
    const data = (await response.json()) as {
      monitor?: { next_run_at?: string };
      error?: string;
    };
    if (!response.ok)
      setError(data.error || "Unable to save monitoring configuration.");
    else {
      setMonitorStatus(
        monitorEnabled ? (data.monitor?.next_run_at
          ? `Next scheduled run: ${new Date(data.monitor.next_run_at).toLocaleString()}`
          : "Monitoring configuration saved.") : "Monitoring paused.",
      );
      setNotice("Monitoring configuration saved.");
    }
    setBusy(false);
  }

  async function checkVerification() {
    if (!activeProject) return;
    setBusy(true);
    clearMessages();
    const response = await apiFetch("/api/domain-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: activeProject.id,
        action: "verify",
        method: verificationMethod,
      }),
    });
    const data = (await response.json()) as {
      verified?: boolean;
      error?: string;
    };
    if (!response.ok || !data.verified)
      setError(data.error || "Verification token was not found.");
    else {
      setNotice("Domain ownership verified.");
      setInstructions(null);
      await refreshWorkspace();
    }
    setBusy(false);
  }

  if (loading)
    return (
      <main className={styles.loading}>
        Preparing your secure command center…
      </main>
    );

  const projectsPanel = (
    <section className={styles.console}>
      <div className={styles.consoleHead}>
        <div>
          <span>PROJECT GOVERNANCE</span>
          <h2>Projects and environments</h2>
          <p>
            Keep crawl targets, environments, and ownership verification inside
            a governed tenant boundary.
          </p>
        </div>
        <button
          className={styles.primary}
          onClick={() => router.push("/onboarding")}
        >
          Add project
        </button>
      </div>
      {visibleProjects.length ? (
        <>
          <div className={styles.projectPicker}>
            {visibleProjects.map((project) => (
              <button
                key={project.id}
                className={
                  activeProject?.id === project.id ? styles.projectActive : ""
                }
                onClick={() => setActiveProjectId(project.id)}
              >
                <b>{project.name}</b>
                <span>{project.domain}</span>
                <small>
                  {project.environment} ·{" "}
                  {project.verified_at ? "verified" : "verification pending"}
                </small>
              </button>
            ))}
          </div>
          {activeProject && (
            <div className={styles.verifyBox}>
              <div>
                <span>DOMAIN OWNERSHIP</span>
                <h3>{activeProject.domain}</h3>
                <p>
                  Verification unlocks governed fixes, monitoring, and
                  higher-trust automation.
                </p>
              </div>
              <div className={styles.inlineForm}>
                <select
                  value={activeProject.environment}
                  onChange={(event) =>
                    updateEnvironment(activeProject.id, event.target.value)
                  }
                  disabled={busy}
                >
                  <option value="production">Production</option>
                  <option value="staging">Staging</option>
                  <option value="development">Development</option>
                </select>
                <select
                  value={verificationMethod}
                  onChange={(event) =>
                    setVerificationMethod(event.target.value)
                  }
                >
                  <option value="dns">DNS TXT</option>
                  <option value="file">Well-known file</option>
                  <option value="meta">Meta tag</option>
                </select>
                <button onClick={startVerification} disabled={busy}>
                  Create challenge
                </button>
                <button
                  className={styles.primary}
                  onClick={checkVerification}
                  disabled={busy}
                >
                  Check verification
                </button>
                <button
                  onClick={() => deleteProject(activeProject.id)}
                  disabled={busy}
                >
                  Delete project
                </button>
              </div>
              {instructions && (
                <pre className={styles.instructions}>
                  {JSON.stringify(instructions, null, 2)}
                </pre>
              )}
            </div>
          )}
        </>
      ) : (
        <div className={styles.emptyState}>
          <h3>No projects yet</h3>
          <p>
            Create the first governed website project to begin collecting
            evidence.
          </p>
          <button
            className={styles.primary}
            onClick={() => router.push("/onboarding")}
          >
            Create project
          </button>
        </div>
      )}
    </section>
  );

  const teamPanel = (
    <section className={styles.console}>
      <div className={styles.consoleHead}>
        <div>
          <span>ROLE-BASED ACCESS</span>
          <h2>Team and permissions</h2>
          <p>
            Owners and admins can add existing WebOps AI accounts and assign
            least-privilege roles.
          </p>
        </div>
      </div>
      {organization ? (
        <>
          <div className={styles.inlineForm}>
            <input
              type="email"
              placeholder="teammate@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              {roles.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
            <button
              className={styles.primary}
              onClick={addMember}
              disabled={busy || !email}
            >
              Add member
            </button>
            <button onClick={createInvitation} disabled={busy || !email}>
              Create invitation
            </button>
          </div>
          {invitationLink && (
            <div className={styles.instructions}>
              <b>Invitation link</b>
              <br />
              {invitationLink}
              <br />
              <button
                onClick={() => navigator.clipboard?.writeText(invitationLink)}
              >
                Copy link
              </button>
            </div>
          )}
          <div className={styles.memberList}>
            {members.map((member) => (
              <article key={member.user_id}>
                <div>
                  <b>{member.email || member.user_id}</b>
                  <small>
                    Added {new Date(member.created_at).toLocaleDateString()}
                  </small>
                </div>
                <select
                  value={member.role}
                  onChange={(event) =>
                    changeRole(member.user_id, event.target.value)
                  }
                  disabled={busy}
                >
                  {roles.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
                <button
                  onClick={() => removeMember(member.user_id)}
                  disabled={busy}
                >
                  Remove
                </button>
              </article>
            ))}
          </div>
          {invitations.length > 0 && (
            <div className={styles.memberList}>
              <h3>Pending invitations</h3>
              {invitations.map((invitation) => (
                <article key={invitation.id}>
                  <div>
                    <b>{invitation.email}</b>
                    <small>
                      {invitation.role} · expires{" "}
                      {new Date(invitation.expires_at).toLocaleDateString()}
                    </small>
                  </div>
                  <button
                    onClick={() => revokeInvitation(invitation.id)}
                    disabled={
                      busy ||
                      Boolean(invitation.revoked_at || invitation.accepted_at)
                    }
                  >
                    {invitation.revoked_at
                      ? "Revoked"
                      : invitation.accepted_at
                        ? "Accepted"
                        : "Revoke"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className={styles.emptyState}>
          <p>Create a workspace before managing access.</p>
        </div>
      )}
    </section>
  );

  const monitoringPanel = (
    <section className={styles.console}>
      <div className={styles.consoleHead}>
        <div>
          <span>CONTINUOUS INTELLIGENCE</span>
          <h2>Scheduled monitoring</h2>
          <p>
            Configure governed recurring baselines for the active project. Runs
            will use the evidence-first audit engine.
          </p>
        </div>
      </div>
      {activeProject ? (
        <>
          <div className={styles.inlineForm}>
            <select
              aria-label="Monitoring cadence"
              value={monitorCadence}
              onChange={(event) =>
                setMonitorCadence(event.target.value as "daily" | "weekly")
              }
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
            <label>
              <input
                type="checkbox"
                checked={monitorEnabled}
                onChange={(event) => setMonitorEnabled(event.target.checked)}
              />{" "}
              Enabled
            </label>
            <button
              className={styles.primary}
              onClick={saveMonitoring}
              disabled={busy}
            >
              Save monitoring
            </button>
          </div>
          {monitorStatus && (
            <div className={styles.instructions}>{monitorStatus}</div>
          )}
          <div className={styles.inlineForm}>
            <button onClick={loadMonitoringAlerts} disabled={!activeProject}>
              Refresh alerts
            </button>
          </div>
          {monitorAlerts.length > 0 && (
            <div className={styles.memberList}>
              {monitorAlerts.map((alert) => (
                <article key={alert.id}>
                  <div>
                    <b>{alert.severity.toUpperCase()} regression alert</b>
                    <small>
                      {new Date(alert.created_at).toLocaleString()} ·{" "}
                      {alert.summary.regressions || 0} regressions · score Δ{" "}
                      {alert.summary.healthScoreDelta ?? "—"}
                    </small>
                  </div>
                  <span>{alert.status}</span>
                  {alert.status === "open" && (
                    <button
                      onClick={() =>
                        updateMonitoringAlert(alert.id, "acknowledged")
                      }
                    >
                      Acknowledge
                    </button>
                  )}
                  {alert.status !== "resolved" && (
                    <button
                      onClick={() =>
                        updateMonitoringAlert(alert.id, "resolved")
                      }
                    >
                      Resolve
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className={styles.emptyState}>
          <p>Create a project before configuring monitoring.</p>
        </div>
      )}
    </section>
  );

  const securityPanel = (
    <section className={styles.console}>
      <div className={styles.consoleHead}>
        <div>
          <span>SECURITY POSTURE</span>
          <h2>Production foundation controls</h2>
          <p>Controls are enforced server-side and designed to fail closed.</p>
        </div>
      </div>
      <div className={styles.controlGrid}>
        {[
          "HttpOnly cookie sessions",
          "Refresh-token rotation",
          "Tenant isolation",
          "Role-based access",
          "SSRF and redirect protection",
          "Origin enforcement",
          "Request-size limits",
          "Domain ownership verification",
          "BYOK browser-secret removal",
          "Security and privacy headers",
        ].map((control) => (
          <article key={control}>
            <i className={styles.good} />
            <b>{control}</b>
            <span>Active</span>
          </article>
        ))}
      </div>
    </section>
  );

  return (
    <div className={`${styles.app} ${theme === "light" ? styles.light : ""}`}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span>W</span>
          <div>
            <b>WebOps AI</b>
            <small>Command platform</small>
          </div>
        </div>
        <div className={styles.org}>
          {organization?.name || "Workspace setup"}
          {organizations.length > 1 && (
            <select
              aria-label="Select workspace"
              value={organization?.id || ""}
              onChange={(event) => {
                setOrganization(
                  organizations.find(
                    (item) => item.id === event.target.value,
                  ) || null,
                );
                setActiveProjectId("");
              }}
            >
              {organizations.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
          <small>
            {activeProject ? activeProject.domain : "No active project"}
          </small>
          <select
            aria-label="Select project"
            value={activeProject?.id || ""}
            disabled={visibleProjects.length <= 1}
            onChange={(event) => setActiveProjectId(event.target.value)}
          >
            {!visibleProjects.length && <option value="">No project</option>}
            {visibleProjects.map((project) => (
              <option value={project.id} key={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <nav>
          {modules.map((name) => (
            <button
              key={name}
              className={active === name ? styles.selected : ""}
              onClick={() => openModule(name)}
            >
              <span>{name}</span>
            </button>
          ))}
        </nav>
        <div className={styles.user}>
          <span>{userEmail.slice(0, 1).toUpperCase() || "W"}</span>
          <div>
            <b>{userEmail || "Authenticated"}</b>
            <small>Secure session</small>
          </div>
          <button onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <main className={styles.main}>
        <header>
          <div>
            <small>WEBOPS INTELLIGENCE / {active.toUpperCase()}</small>
            <h1>{active}</h1>
          </div>
          <div className={styles.headerActions}>
            <button onClick={toggleTheme}>
              {theme === "dark" ? "☀ Light" : "◐ Dark"}
            </button>
            <button onClick={() => setPaletteOpen(true)}>⌘ Search</button>
            <button
              className={styles.primary}
              onClick={() => router.push(projectTarget)}
            >
              {activeProject ? "Run audit" : "Create project"}
            </button>
          </div>
        </header>
        {error && <div className={styles.alertError}>{error}</div>}
        {notice && <div className={styles.alertSuccess}>{notice}</div>}
        {active === "Command Center" ? (
          <>
            <section className={styles.hero}>
              <div>
                <span>PHASE 1 · SECURE FOUNDATION</span>
                <h2>Your evidence command center is online.</h2>
                <p>
                  A governed workspace for technical SEO, performance,
                  accessibility, assets, links, security, fixes, and AI
                  operations.
                </p>
                <div>
                  <button
                    className={styles.primary}
                    onClick={() => router.push(projectTarget)}
                  >
                    {activeProject
                      ? "Start baseline audit"
                      : "Finish workspace setup"}
                  </button>
                  <button onClick={() => setActive("Security")}>
                    Review foundation
                  </button>
                </div>
              </div>
              <div className={styles.orb}>
                <b>{String(visibleProjects.length).padStart(2, "0")}</b>
                <span>active projects</span>
              </div>
            </section>
            <section className={styles.readiness}>
              {[
                { label: "Identity", value: "Ready", ready: true },
                {
                  label: "Tenant",
                  value: organization ? "Ready" : "Setup needed",
                  ready: Boolean(organization),
                },
                {
                  label: "Project",
                  value: activeProject ? "Ready" : "Setup needed",
                  ready: Boolean(activeProject),
                },
                {
                  label: "Domain",
                  value: activeProject?.verified_at ? "Verified" : "Pending",
                  ready: Boolean(activeProject?.verified_at),
                },
              ].map((item) => (
                <article key={item.label}>
                  <small>{item.label}</small>
                  <b>{item.value}</b>
                  <i className={item.ready ? styles.good : styles.warn} />
                </article>
              ))}
            </section>
            {!activeProject && (
              <section className={styles.setup}>
                <div>
                  <span>Action required</span>
                  <h3>Create your organization and first project</h3>
                  <p>
                    Projects provide the evidence, audit-history, security, and
                    ownership boundary for every scan.
                  </p>
                </div>
                <button
                  className={styles.primary}
                  onClick={() => router.push("/onboarding")}
                >
                  Start guided setup
                </button>
              </section>
            )}
            <section>
              <div className={styles.sectionHead}>
                <div>
                  <small>PLATFORM MAP</small>
                  <h3>Premium intelligence modules</h3>
                </div>
                <span>{modules.length - 1} capabilities</span>
              </div>
              <div className={styles.moduleGrid}>
                {modules.slice(1).map((name, index) => (
                  <button key={name} onClick={() => openModule(name)}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <b>{name}</b>
                    <small>
                      {[
                        "Security",
                        "Audits",
                        "Projects",
                        "Team & Access",
                      ].includes(name)
                        ? "Foundation active"
                        : "Engine scheduled"}
                    </small>
                  </button>
                ))}
              </div>
            </section>
          </>
        ) : active === "Projects" ? (
          projectsPanel
        ) : active === "Team & Access" ? (
          teamPanel
        ) : active === "Security" ? (
          securityPanel
        ) : active === "Monitoring" ? (
          monitoringPanel
        ) : (
          <section className={styles.modulePanel}>
            <div>
              <span>{active.toUpperCase()}</span>
              <h2>{active} evidence workspace</h2>
              <p>
                Run a governed baseline audit for the active project to populate
                this module with real crawl evidence. WebOps AI will not display
                invented metrics.
              </p>
              <div className={styles.inlineForm}>
                <button
                  className={styles.primary}
                  onClick={() => router.push(projectTarget)}
                >
                  {activeProject ? "Open audit workbench" : "Create project"}
                </button>
                <button onClick={() => setActive("Projects")}>
                  Manage project
                </button>
                <button onClick={() => setActive("Command Center")}>
                  Return to Command Center
                </button>
              </div>
            </div>
          </section>
        )}
      </main>
      {paletteOpen && (
        <div className={styles.overlay} onClick={() => setPaletteOpen(false)}>
          <div
            className={styles.palette}
            onClick={(event) => event.stopPropagation()}
          >
            <input autoFocus placeholder="Jump to a module…" />
            <div>
              {modules.map((name) => (
                <button key={name} onClick={() => openModule(name)}>
                  {name}
                  <span>Open →</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
