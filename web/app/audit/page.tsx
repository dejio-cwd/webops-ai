"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_LABELS } from "@/lib/types";
import type {
  AuditResult,
  Opportunity,
  Finding,
  PageEvidence,
  Severity,
} from "@/lib/types";
import type { PageSpeedResult } from "@/lib/pagespeed";
import {
  loadSettings,
  saveSettings,
  upsertConnection,
  removeConnection as removeConnectionFromSettings,
  connectionForTask,
  toCredential,
  newId,
  CRAWL_LIMITS,
  PROVIDER_META,
  type AiSettings,
  type AiConnection,
  type AiTask,
  type ProviderId,
} from "@/lib/connections";

const MODULES = [
  "Overview",
  "Opportunities",
  "Findings",
  "Crawl",
  "Performance",
  "Links & Images",
  "AI Studio",
  "Fix Center",
  "Roadmap",
] as const;
type Module = (typeof MODULES)[number];

const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];
const PAGE_PRESETS = [10, 30, 100, 300, 1000];

function sevClass(s: string) {
  return `badge sev-${s}`;
}
function scoreColor(n: number) {
  if (n >= 90) return "var(--good)";
  if (n >= 75) return "var(--brand-2)";
  if (n >= 50) return "var(--warn)";
  return "var(--bad)";
}

type Credential = ReturnType<typeof toCredential>;
type AuditRunSummary = {
  id: string;
  url: string;
  audit_id: string;
  engine_version: string;
  status: string;
  summary: { pagesCrawled?: number; healthScore?: number };
  created_at: string;
  completed_at: string | null;
};

export default function Home() {
  const [active, setActive] = useState<Module>("Overview");
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(30);
  const [running, setRunning] = useState(false);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<AuditRunSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [environment, setEnvironment] = useState("");
  const [comparison, setComparison] = useState<{
    healthScoreDelta: number;
    pagesCrawledDelta: number;
    newFindings: Finding[];
    resolvedFindings: Finding[];
    persistentFindings: Finding[];
    regressions: Finding[];
  } | null>(null);

  const [settings, setSettings] = useState<AiSettings>(loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"connections" | "crawl">(
    "connections",
  );

  // Hydrate from localStorage after mount (SSR-safe: loadSettings() returns
  // identical defaults on server and first client render, so no mismatch).
  useEffect(() => {
    const loaded = loadSettings();
    // one-time read of a browser-only store (localStorage); not derivable during render
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(loaded);
    setMaxPages(loaded.crawlDefaults.maxPages);
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/audit", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setHistory((data.runs || []) as AuditRunSummary[]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedUrl = params.get("url");
    const requestedModule = params.get("module") as Module | null;
    if (requestedUrl) setUrl(requestedUrl);
    if (requestedModule && MODULES.includes(requestedModule))
      setActive(requestedModule);
  }, []);

  const persistSettings = useCallback((next: AiSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const openSettings = useCallback((tab: "connections" | "crawl") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  const getCredential = useCallback(
    (task: AiTask): Credential =>
      toCredential(connectionForTask(settings, task)),
    [settings],
  );

  const runAudit = useCallback(async () => {
    if (!url.trim()) {
      setError("Enter a website URL first.");
      return;
    }
    setRunning(true);
    setError("");
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          projectId: projectId || undefined,
          environment: environment || undefined,
          maxPages,
          maxDepth: settings.crawlDefaults.maxDepth,
          concurrency: settings.crawlDefaults.concurrency,
          respectRobots: settings.crawlDefaults.respectRobots,
          checkExternalLinks: settings.crawlDefaults.checkExternalLinks,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Audit failed.");
      setAudit(data as AuditResult);
      setActive("Overview");
      void loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audit failed.");
    } finally {
      setRunning(false);
    }
  }, [
    url,
    projectId,
    environment,
    maxPages,
    settings.crawlDefaults,
    loadHistory,
  ]);

  const compareWithCurrent = useCallback(
    async (beforeId: string) => {
      if (!audit) return;
      const res = await fetch(
        `/api/audit?before=${encodeURIComponent(beforeId)}&after=${encodeURIComponent(audit.auditId)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Unable to compare audits.");
        return;
      }
      setComparison(data.comparison);
    },
    [audit],
  );

  const loadHistoricalAudit = useCallback(async (auditId: string) => {
    setError("");
    const res = await fetch(
      `/api/audit?auditId=${encodeURIComponent(auditId)}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error || "Unable to load audit.");
      return;
    }
    setAudit(data.audit as AuditResult);
    setUrl(data.audit.crawl.requestedUrl);
    setActive("Overview");
  }, []);

  const findingCount = audit?.findings.length ?? 0;
  const oppCount = audit?.opportunities.length ?? 0;

  const counts: Partial<Record<Module, number>> = {
    Opportunities: oppCount,
    Findings: findingCount,
    Crawl: audit?.crawl.pagesCrawled ?? 0,
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">W</div>
          <div>
            <strong>WebOps AI</strong>
            <small>Evidence intelligence</small>
          </div>
        </div>
        <div className="nav-label">Platform</div>
        <nav className="nav">
          {MODULES.map((m) => (
            <button
              key={m}
              className={active === m ? "active" : ""}
              onClick={() => setActive(m)}
            >
              <span>{m}</span>
              {counts[m] !== undefined && (
                <span className={`pill ${counts[m] ? "" : "zero"}`}>
                  {counts[m]}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-label" style={{ marginTop: 20 }}>
          Model
        </div>
        <div style={{ padding: "0 6px" }}>
          <div className="chip">Find → Explain → Prioritize → Fix → Verify</div>
        </div>
        <div className="sidebar-footer">
          <a className="sidebar-btn" href="/workspace">
            <span>←</span>
            <span>Command Center</span>
          </a>
          <button
            className="sidebar-btn"
            onClick={() => openSettings("connections")}
          >
            <span>⚙</span>
            <span>AI connections &amp; BYOK</span>
          </button>
          <button className="sidebar-btn" onClick={() => openSettings("crawl")}>
            <span>⛭</span>
            <span>Crawl settings</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="crumb">
            {audit ? (
              <>
                Audit of <b>{new URL(audit.crawl.origin).host}</b> · {active}
              </>
            ) : (
              <>WebOps AI · {active}</>
            )}
          </div>
          {audit && (
            <div className="chip">
              engine v{audit.version} ·{" "}
              {new Date(audit.capturedAt).toLocaleString()}
            </div>
          )}
        </div>

        <div className="runbar">
          <div className="field" style={{ flex: 1 }}>
            <label>Website URL</label>
            <input
              className="url-input"
              type="text"
              placeholder="example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !running && runAudit()}
            />
          </div>
          <div className="field">
            <label>Max pages</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="number"
                min={1}
                max={CRAWL_LIMITS.maxPages}
                value={maxPages}
                onChange={(e) =>
                  setMaxPages(
                    Math.max(
                      1,
                      Math.min(
                        CRAWL_LIMITS.maxPages,
                        Number(e.target.value) || 1,
                      ),
                    ),
                  )
                }
                style={{ width: 84 }}
              />
              <div style={{ display: "flex", gap: 4 }}>
                {PAGE_PRESETS.map((p) => (
                  <button
                    key={p}
                    className="chip"
                    style={{ cursor: "pointer", border: 0 }}
                    onClick={() => setMaxPages(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button className="btn" onClick={runAudit} disabled={running}>
              {running ? (
                <>
                  <span className="spinner" />
                  Crawling…
                </>
              ) : (
                "Run audit"
              )}
            </button>
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button
              className="icon-btn"
              title="Advanced crawl settings"
              onClick={() => openSettings("crawl")}
            >
              ⚙
            </button>
          </div>
        </div>

        {error && (
          <div className="notice bad" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        {!audit && !running && <Welcome />}
        {!running && (
          <AuditHistory
            runs={history}
            loading={historyLoading}
            onRefresh={loadHistory}
            onOpen={loadHistoricalAudit}
            audit={audit}
            compareWithCurrent={compareWithCurrent}
          />
        )}
        {comparison && (
          <div className="card" style={{ marginTop: 16 }}>
            <h3>Audit comparison</h3>
            <div className="sub">
              Evidence delta from the selected historical run to the current
              audit.
            </div>
            <div className="kv">
              <span>Health score change</span>
              <b>
                {comparison.healthScoreDelta > 0 ? "+" : ""}
                {comparison.healthScoreDelta}
              </b>
            </div>
            <div className="kv">
              <span>New findings / regressions</span>
              <b>
                {comparison.newFindings.length} /{" "}
                {comparison.regressions.length}
              </b>
            </div>
            <div className="kv">
              <span>Resolved findings</span>
              <b>{comparison.resolvedFindings.length}</b>
            </div>
            <div className="kv">
              <span>Persistent findings</span>
              <b>{comparison.persistentFindings.length}</b>
            </div>
            {comparison.regressions.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <b style={{ color: "var(--bad)" }}>Regression alerts</b>
                {comparison.regressions.slice(0, 8).map((finding) => (
                  <div
                    key={`${finding.ruleId}-${finding.url}`}
                    className="kv"
                    style={{ marginTop: 6 }}
                  >
                    <span>
                      <span className={sevClass(finding.severity)}>
                        {finding.severity}
                      </span>{" "}
                      {finding.title}
                    </span>
                    <span
                      style={{
                        maxWidth: 360,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {finding.url}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {running && !audit && (
          <div className="empty">
            <span className="spinner" /> Crawling up to {maxPages} page
            {maxPages === 1 ? "" : "s"}, running the rules engine, and scoring…
          </div>
        )}

        {audit && active === "Overview" && (
          <Overview
            audit={audit}
            onJump={setActive}
            credential={getCredential("summary")}
          />
        )}
        {audit && active === "Opportunities" && (
          <Opportunities
            audit={audit}
            explainCred={getCredential("explain")}
            fixCred={getCredential("fix")}
          />
        )}
        {audit && active === "Findings" && <Findings audit={audit} />}
        {audit && active === "Crawl" && <Crawl audit={audit} />}
        {audit && active === "Performance" && (
          <Performance origin={audit.crawl.requestedUrl} />
        )}
        {audit && active === "Links & Images" && <LinksImages audit={audit} />}
        {active === "AI Studio" && (
          <AiStudio
            settings={settings}
            onOpenSettings={openSettings}
            audit={audit}
          />
        )}
        {audit && active === "Fix Center" && (
          <FixCenter
            audit={audit}
            fixCred={getCredential("fix")}
            projectId={projectId}
          />
        )}
        {active === "Roadmap" && <Roadmap />}
      </main>

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          initialTab={settingsTab}
          onClose={() => setSettingsOpen(false)}
          onChange={persistSettings}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function AuditHistory({
  runs,
  loading,
  onRefresh,
  onOpen,
  audit,
  compareWithCurrent,
}: {
  runs: AuditRunSummary[];
  loading: boolean;
  onRefresh: () => void;
  onOpen: (auditId: string) => void;
  audit: AuditResult | null;
  compareWithCurrent: (auditId: string) => void;
}) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div>
          <h3>Recent audit history</h3>
          <div className="sub">
            Stored evidence from your authenticated audit runs.
          </div>
        </div>
        <button className="btn ghost sm" onClick={onRefresh} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {!runs.length && !loading && (
        <div className="empty" style={{ marginTop: 12 }}>
          No stored audits yet. Run an audit to create the first evidence
          record.
        </div>
      )}
      {runs.map((run) => (
        <button
          key={run.id}
          className="history-row"
          onClick={() => onOpen(run.audit_id)}
          style={{
            display: "flex",
            width: "100%",
            justifyContent: "space-between",
            textAlign: "left",
            gap: 12,
            marginTop: 10,
            padding: 12,
            borderRadius: 10,
            border: "1px solid var(--line)",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          <span>
            <b>{run.url}</b>
            <small
              style={{ display: "block", color: "var(--muted)", marginTop: 4 }}
            >
              {new Date(run.created_at).toLocaleString()} · {run.status}
            </small>
          </span>
          <span style={{ whiteSpace: "nowrap", color: "var(--muted)" }}>
            {run.summary.pagesCrawled ?? 0} pages · score{" "}
            {run.summary.healthScore ?? "—"}
          </span>
          {audit && audit.auditId !== run.audit_id && (
            <span
              onClick={(event) => {
                event.stopPropagation();
                compareWithCurrent(run.audit_id);
              }}
              style={{ color: "var(--brand-2)" }}
            >
              Compare
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function Welcome() {
  return (
    <div className="card" style={{ padding: "26px 24px" }}>
      <h3 style={{ fontSize: 18 }}>Audit any public website in one pass</h3>
      <p className="muted" style={{ maxWidth: 640, marginTop: 6 }}>
        WebOps AI crawls the site, captures verifiable evidence for every page,
        runs a deterministic rules engine across SEO, indexability, content,
        links, images, structured data, accessibility and security, then rolls
        everything up into prioritized opportunities. Add a PageSpeed key for
        real Core Web Vitals, and configure an AI connection (BYOK, any
        provider) for evidence-grounded fix playbooks and the Mule assistant.
      </p>
      <div className="grid cols-4" style={{ marginTop: 18 }}>
        {[
          [
            "Real crawler",
            "BFS, robots.txt, sitemap, configurable depth & page limits",
          ],
          ["40+ rules", "Deterministic, reproducible, explained"],
          ["Core Web Vitals", "Lighthouse via Google, no local Chrome"],
          ["AI copilot + Mule", "Any provider, BYOK, grounded in evidence"],
        ].map(([t, s]) => (
          <div className="metric" key={t}>
            <div className="metric-label">{t}</div>
            <div className="metric-note" style={{ marginTop: 8 }}>
              {s}
            </div>
          </div>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 16, fontSize: 12.5 }}>
        Enter a URL above and press <b>Run audit</b>. Try{" "}
        <code>vercel.com</code> or your own site.
      </p>
    </div>
  );
}

function Ring({ score, grade }: { score: number; grade: string }) {
  const r = 56;
  const c = 2 * Math.PI * r;
  const off = c * (1 - score / 100);
  const col = scoreColor(score);
  return (
    <div className="ring">
      <svg width="132" height="132" viewBox="0 0 132 132">
        <circle
          cx="66"
          cy="66"
          r={r}
          fill="none"
          stroke="var(--bg-2)"
          strokeWidth="12"
        />
        <circle
          cx="66"
          cy="66"
          r={r}
          fill="none"
          stroke={col}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
        />
      </svg>
      <div className="val">
        <b style={{ color: col }}>{score}</b>
        <span>Health · {grade}</span>
      </div>
    </div>
  );
}

function Overview({
  audit,
  onJump,
  credential,
}: {
  audit: AuditResult;
  onJump: (m: Module) => void;
  credential: Credential;
}) {
  const { health, crawl, opportunities } = audit;
  const cats = Object.entries(health.categories) as [string, number][];
  const sevCounts = audit.findingCountsBySeverity;
  const [summary, setSummary] = useState("");
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryErr, setSummaryErr] = useState("");

  const genSummary = async () => {
    setLoadingSummary(true);
    setSummaryErr("");
    setSummary("");
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "summary",
          credential,
          context: {
            url: crawl.origin,
            health,
            crawl,
            topFindings: audit.findings.slice(0, 15).map((f) => ({
              title: f.title,
              severity: f.severity,
              url: f.url,
            })),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "AI request failed.");
      setSummary(data.text);
    } catch (e) {
      setSummaryErr(e instanceof Error ? e.message : "AI request failed.");
    } finally {
      setLoadingSummary(false);
    }
  };

  return (
    <>
      <div className="grid cols-2">
        <div className="card">
          <div className="score-hero">
            <Ring score={health.overall} grade={health.grade} />
            <div style={{ flex: 1 }}>
              <h3>Overall health</h3>
              <div className="sub">
                Importance-weighted across evaluated categories
              </div>
              {cats
                .sort((a, b) => a[1] - b[1])
                .map(([cat, score]) => (
                  <div className="cat-row" key={cat}>
                    <span className="name">
                      {CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ||
                        cat}
                    </span>
                    <span className="bar">
                      <span
                        style={{
                          width: `${score}%`,
                          background: scoreColor(score),
                        }}
                      />
                    </span>
                    <span className="num">{score}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
        <div className="card">
          <h3>Findings by severity</h3>
          <div className="sub">
            {audit.findings.length} findings across {crawl.pagesCrawled} pages
          </div>
          {SEV_ORDER.map((s) => (
            <div className="cat-row" key={s}>
              <span className="name">
                <span className={sevClass(s)}>{s}</span>
              </span>
              <span className="bar">
                <span
                  style={{
                    width: `${audit.findings.length ? ((sevCounts[s] || 0) / audit.findings.length) * 100 : 0}%`,
                    background:
                      s === "critical"
                        ? "var(--crit)"
                        : s === "high"
                          ? "var(--bad)"
                          : s === "medium"
                            ? "var(--warn)"
                            : s === "low"
                              ? "#7fb8ff"
                              : "var(--text-faint)",
                  }}
                />
              </span>
              <span className="num">{sevCounts[s] || 0}</span>
            </div>
          ))}
          <div style={{ marginTop: 14 }}>
            <button
              className="btn ghost sm"
              onClick={() => onJump("Opportunities")}
            >
              View opportunities →
            </button>
          </div>
        </div>
      </div>

      <div className="section-title">Crawl summary</div>
      <div className="grid cols-4">
        <Metric
          label="Pages crawled"
          value={String(crawl.pagesCrawled)}
          note={`${crawl.pagesRequested} requested${crawl.truncated ? " · truncated" : ""}`}
        />
        <Metric
          label="Duration"
          value={`${(crawl.durationMs / 1000).toFixed(1)}s`}
          note={`depth ≤ ${crawl.maxDepth} · cap ${crawl.maxPages}`}
        />
        <Metric
          label="Broken links"
          value={String(crawl.brokenLinks.length)}
          note="internal + external"
        />
        <Metric
          label="robots / sitemap"
          value={`${crawl.robotsFound ? "✓" : "✗"} / ${crawl.sitemapFound ? "✓" : "✗"}`}
          note={
            crawl.fromSitemap
              ? `${crawl.fromSitemap} URLs from sitemap`
              : "no sitemap URLs"
          }
        />
      </div>

      <div className="section-title">AI executive summary</div>
      <div className="card">
        {!summary && !loadingSummary && (
          <button className="btn sm" onClick={genSummary}>
            Generate AI summary
          </button>
        )}
        {loadingSummary && (
          <div className="muted">
            <span className="spinner" />
            Writing summary…
          </div>
        )}
        {summaryErr && <div className="notice bad">{summaryErr}</div>}
        {summary && (
          <>
            <div className="ai-out">{summary}</div>
            <button
              className="btn ghost sm"
              style={{ marginTop: 10 }}
              onClick={genSummary}
            >
              Regenerate
            </button>
          </>
        )}
      </div>

      <div className="section-title">Top opportunities</div>
      {opportunities.slice(0, 3).map((o) => (
        <OppCard key={o.id} opp={o} compact />
      ))}
      {opportunities.length > 3 && (
        <button
          className="btn ghost sm"
          onClick={() => onJump("Opportunities")}
        >
          See all {opportunities.length} opportunities →
        </button>
      )}
    </>
  );
}

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value blue">{value}</div>
      <div className="metric-note">{note}</div>
    </div>
  );
}

/* ------- Opportunities + AI ------- */

function Opportunities({
  audit,
  explainCred,
  fixCred,
}: {
  audit: AuditResult;
  explainCred: Credential;
  fixCred: Credential;
}) {
  if (!audit.opportunities.length)
    return (
      <div className="empty">
        No opportunities — the rules engine found nothing to fix. 🎉
      </div>
    );
  return (
    <>
      <p className="muted" style={{ marginBottom: 14 }}>
        {audit.opportunities.length} prioritized actions. Score = severity ×
        scope × ease. Use the AI buttons to generate an evidence-grounded
        explanation or a step-by-step fix playbook, powered by whichever
        connection you set as default (or routed) in AI Studio.
      </p>
      {audit.opportunities.map((o) => (
        <OppCard
          key={o.id}
          opp={o}
          explainCred={explainCred}
          fixCred={fixCred}
        />
      ))}
    </>
  );
}

function OppCard({
  opp,
  compact,
  explainCred,
  fixCred,
}: {
  opp: Opportunity;
  compact?: boolean;
  explainCred?: Credential;
  fixCred?: Credential;
}) {
  const [out, setOut] = useState("");
  const [loading, setLoading] = useState<"" | "explain" | "fix">("");
  const [err, setErr] = useState("");

  const ask = async (mode: "explain" | "fix") => {
    setLoading(mode);
    setErr("");
    setOut("");
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          opportunity: opp,
          credential: mode === "fix" ? fixCred : explainCred,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "AI request failed.");
      setOut(`${data.text}\n\n— ${data.provider} · ${data.model}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI request failed.");
    } finally {
      setLoading("");
    }
  };

  return (
    <div className="opp">
      <div className="opp-head">
        <div style={{ flex: 1 }}>
          <h4>{opp.title}</h4>
          <div className="meta">
            <span className={sevClass(opp.severity)}>{opp.severity}</span>
            <span className="chip">{CATEGORY_LABELS[opp.category]}</span>
            <span className="chip">
              {opp.affectedCount} page{opp.affectedCount === 1 ? "" : "s"}
            </span>
            <span className="chip">effort: {opp.effort}</span>
            <span className="chip">confidence: {opp.confidence}</span>
          </div>
          <p>
            <b>Why:</b> {opp.why}
          </p>
          <p>
            <b>Fix:</b> {opp.recommendation}
          </p>
          {!compact && opp.sampleEvidence.length > 0 && (
            <p
              className="muted"
              style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}
            >
              {opp.sampleEvidence.slice(0, 2).join("  ·  ")}
            </p>
          )}
        </div>
        <div className="opp-score">
          <b style={{ color: scoreColor(opp.score) }}>{opp.score}</b>
          <span>priority</span>
        </div>
      </div>
      {!compact && (
        <div className="actions">
          <button
            className="btn sm"
            onClick={() => ask("explain")}
            disabled={!!loading}
          >
            {loading === "explain" ? (
              <>
                <span className="spinner" />
                Explaining…
              </>
            ) : (
              "Explain with AI"
            )}
          </button>
          <button
            className="btn ghost sm"
            onClick={() => ask("fix")}
            disabled={!!loading}
          >
            {loading === "fix" ? (
              <>
                <span className="spinner" />
                Generating…
              </>
            ) : (
              "Generate fix playbook"
            )}
          </button>
        </div>
      )}
      {err && (
        <div className="notice bad" style={{ marginTop: 10 }}>
          {err}
        </div>
      )}
      {out && <div className="ai-out">{out}</div>}
    </div>
  );
}

/* ------- Fix Center ------- */

function FixCenter({
  audit,
  fixCred,
  projectId,
}: {
  audit: AuditResult;
  fixCred: Credential;
  projectId: string;
}) {
  const [states, setStates] = useState<
    Record<string, "draft" | "ready" | "verified">
  >({});
  const [selected, setSelected] = useState<string | null>(null);
  const [playbooks, setPlaybooks] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<string | null>(null);
  const generatePlaybook = async (opp: Opportunity) => {
    setGenerating(opp.id);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "fix",
          opportunity: opp,
          credential: fixCred,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data?.error || "Unable to generate playbook.");
      setPlaybooks((current) => ({ ...current, [opp.id]: data.text }));
    } catch (error) {
      setPlaybooks((current) => ({
        ...current,
        [opp.id]:
          error instanceof Error
            ? error.message
            : "Unable to generate playbook.",
      }));
    } finally {
      setGenerating(null);
    }
  };
  if (!audit.opportunities.length)
    return (
      <div className="empty">
        No evidence-backed fixes are currently required.
      </div>
    );
  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Fix Center</h3>
        <p className="muted">
          Evidence-backed resolution queue. Move a recommendation through draft,
          ready for approval, and verified only after validation.
        </p>
      </div>
      {audit.opportunities.map((opp) => {
        const state = states[opp.id] || "draft";
        const advance = async () => {
          const next =
            state === "draft"
              ? "ready"
              : state === "ready"
                ? "verified"
                : "draft";
          setStates((current) => ({ ...current, [opp.id]: next }));
          await fetch("/api/fixes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              auditId: audit.auditId,
              projectId: projectId || undefined,
              opportunityId: opp.id,
              title: opp.title,
              status: next,
              evidence: opp.sampleEvidence,
              recommendation: opp.recommendation,
              verificationNote:
                next === "verified"
                  ? "Verified after rerunning the relevant audit rule."
                  : undefined,
              rollbackPlan:
                "Revert the change and rerun the audit if the finding persists or a regression appears.",
            }),
          });
        };
        return (
          <div className="opp" key={opp.id}>
            <div className="opp-head">
              <div style={{ flex: 1 }}>
                <h4>{opp.title}</h4>
                <div className="meta">
                  <span className={sevClass(opp.severity)}>{opp.severity}</span>
                  <span className="chip">
                    {opp.affectedCount} affected pages
                  </span>
                  <span className="chip">state: {state}</span>
                </div>
                <p>
                  <b>Evidence:</b>{" "}
                  {opp.sampleEvidence.slice(0, 2).join(" · ") ||
                    "Recorded by deterministic rule engine."}
                </p>
                <p>
                  <b>Recommended resolution:</b> {opp.recommendation}
                </p>
              </div>
              <div className="opp-score">
                <b style={{ color: scoreColor(opp.score) }}>{opp.score}</b>
                <span>priority</span>
              </div>
            </div>
            <div className="actions">
              <button
                className="btn ghost sm"
                onClick={() => void generatePlaybook(opp)}
                disabled={generating === opp.id}
              >
                {generating === opp.id
                  ? "Generating…"
                  : "Generate evidence-grounded playbook"}
              </button>
              <button className="btn sm" onClick={() => void advance()}>
                {state === "draft"
                  ? "Mark ready for approval"
                  : state === "ready"
                    ? "Mark verified"
                    : "Reopen fix"}
              </button>
              <button
                className="btn ghost sm"
                onClick={() => setSelected(selected === opp.id ? null : opp.id)}
              >
                {selected === opp.id
                  ? "Hide validation"
                  : "Validation checklist"}
              </button>
            </div>
            {playbooks[opp.id] && (
              <div className="ai-out">
                <b>Evidence-grounded playbook</b>
                <br />
                {playbooks[opp.id]}
                <br />
                <span className="muted">
                  Validate affected URLs and retain the rollback plan before
                  applying.
                </span>
              </div>
            )}
            {selected === opp.id && (
              <div className="ai-out">
                <b>Validation checklist</b>
                <br />
                1. Apply the change only to the affected scope.
                <br />
                2. Re-run the relevant audit rule.
                <br />
                3. Confirm the affected URL and evidence changed.
                <br />
                4. Roll back if the finding persists or a regression appears.
                <br />
                <span className="muted">
                  AI playbook generation remains governed by the selected
                  server-side credential.
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------- Findings ------- */

function Findings({ audit }: { audit: AuditResult }) {
  const [cat, setCat] = useState<string>("all");
  const cats = ["all", ...Object.keys(audit.findingCountsByCategory)];
  const shown = audit.findings
    .filter((f) => cat === "all" || f.category === cat)
    .sort(
      (a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity),
    );
  return (
    <>
      <div className="tabbar">
        {cats.map((c) => (
          <button
            key={c}
            className={cat === c ? "active" : ""}
            onClick={() => setCat(c)}
          >
            {c === "all"
              ? "All"
              : CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS] || c}
            {c !== "all" && ` (${audit.findingCountsByCategory[c]})`}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="empty">No findings in this category.</div>
      ) : (
        shown.slice(0, 300).map((f, i) => <FindingRow key={i} f={f} />)
      )}
    </>
  );
}

function FindingRow({ f }: { f: Finding }) {
  return (
    <div className="card" style={{ marginBottom: 9, padding: "13px 15px" }}>
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span className={sevClass(f.severity)}>{f.severity}</span>
        <b style={{ fontSize: 13.5 }}>{f.title}</b>
        <span className="chip">{CATEGORY_LABELS[f.category]}</span>
        <span className="chip" style={{ fontFamily: "var(--mono)" }}>
          {f.ruleId}
        </span>
      </div>
      <p className="muted" style={{ margin: "7px 0 4px", fontSize: 12.5 }}>
        {f.detail}
      </p>
      <div className="kv">
        <span>Affected</span>
        <span className="u" style={{ maxWidth: 420 }}>
          {f.url}
        </span>
      </div>
      {f.evidence && (
        <div
          className="muted"
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            marginTop: 6,
            whiteSpace: "pre-wrap",
          }}
        >
          {f.evidence.slice(0, 300)}
        </div>
      )}
    </div>
  );
}

/* ------- Crawl / pages ------- */

function Crawl({ audit }: { audit: AuditResult }) {
  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 18 }}>
        {Object.entries(audit.crawl.statusCounts).map(([k, v]) => (
          <Metric
            key={k}
            label={`HTTP ${k}`}
            value={String(v)}
            note="responses"
          />
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>URL</th>
              <th>Title</th>
              <th>Words</th>
              <th>Depth</th>
              <th>Index</th>
              <th>Issues</th>
            </tr>
          </thead>
          <tbody>
            {audit.pages.map((p: PageEvidence) => (
              <tr key={p.url}>
                <td>
                  <span
                    className="status-dot"
                    style={{
                      background:
                        p.status >= 400 || p.status === 0
                          ? "var(--bad)"
                          : p.redirected
                            ? "var(--warn)"
                            : "var(--good)",
                    }}
                  />
                  {p.status || "ERR"}
                </td>
                <td className="u" title={p.url}>
                  {new URL(p.url).pathname || "/"}
                </td>
                <td
                  style={{
                    maxWidth: 260,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.title || <span className="muted">—</span>}
                </td>
                <td>{p.wordCount || "—"}</td>
                <td>{p.depth}</td>
                <td>
                  {p.indexable ? (
                    <span style={{ color: "var(--good)" }}>yes</span>
                  ) : (
                    <span className="muted">
                      {p.indexabilityReason || "no"}
                    </span>
                  )}
                </td>
                <td>{p.findings.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ------- Performance ------- */

function Performance({ origin }: { origin: string }) {
  const [strategy, setStrategy] = useState<"mobile" | "desktop">("mobile");
  const [perf, setPerf] = useState<PageSpeedResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const run = async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: origin, strategy }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Performance check failed.");
      setPerf(data as PageSpeedResult);
      if (data.error) setErr(data.error);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Performance check failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="runbar">
        <div className="field">
          <label>Strategy</label>
          <select
            value={strategy}
            onChange={(e) =>
              setStrategy(e.target.value as "mobile" | "desktop")
            }
          >
            <option value="mobile">Mobile</option>
            <option value="desktop">Desktop</option>
          </select>
        </div>
        <div className="field">
          <label>&nbsp;</label>
          <button className="btn" onClick={run} disabled={loading}>
            {loading ? (
              <>
                <span className="spinner" />
                Measuring…
              </>
            ) : (
              "Measure Core Web Vitals"
            )}
          </button>
        </div>
        <div className="field" style={{ flex: 1, justifyContent: "flex-end" }}>
          <span className="muted" style={{ fontSize: 12 }}>
            Powered by Google PageSpeed Insights (Lighthouse). No local Chrome
            required.
          </span>
        </div>
      </div>
      {err && (
        <div className="notice warn" style={{ marginBottom: 14 }}>
          {err}
        </div>
      )}
      {!perf && !loading && (
        <div className="empty">
          Run a measurement to see real Lighthouse scores and field data.
        </div>
      )}
      {perf && (
        <>
          <div className="grid cols-4">
            <ScoreTile label="Performance" score={perf.scores.performance} />
            <ScoreTile
              label="Accessibility"
              score={perf.scores.accessibility}
            />
            <ScoreTile
              label="Best Practices"
              score={perf.scores.bestPractices}
            />
            <ScoreTile label="SEO" score={perf.scores.seo} />
          </div>
          <div className="section-title">Lab metrics ({perf.strategy})</div>
          <div className="cwv">
            <LabTile label="LCP" m={perf.lab.lcp} unit="ms" />
            <LabTile label="CLS" m={perf.lab.cls} unit="" />
            <LabTile label="TBT" m={perf.lab.tbt} unit="ms" />
            <LabTile label="FCP" m={perf.lab.fcp} unit="ms" />
            <LabTile label="Speed Index" m={perf.lab.speedIndex} unit="ms" />
            <LabTile label="TTI" m={perf.lab.tti} unit="ms" />
          </div>
          {perf.field.hasData && (
            <>
              <div className="section-title">
                Field data (real users · CrUX)
              </div>
              <div className="grid cols-4">
                <FieldTile label="LCP" cat={perf.field.lcp} />
                <FieldTile label="CLS" cat={perf.field.cls} />
                <FieldTile label="INP" cat={perf.field.inp} />
                <FieldTile label="Overall" cat={perf.field.overall} />
              </div>
            </>
          )}
          {perf.opportunities.length > 0 && (
            <>
              <div className="section-title">Lighthouse opportunities</div>
              {perf.opportunities.map((o, i) => (
                <div className="kv" key={i}>
                  <span>{o.title}</span>
                  <b>
                    {o.displayValue || `${(o.savingsMs / 1000).toFixed(2)}s`}
                  </b>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </>
  );
}

function ScoreTile({ label, score }: { label: string; score: number | null }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div
        className="metric-value"
        style={{
          color: score === null ? "var(--text-faint)" : scoreColor(score),
        }}
      >
        {score === null ? "—" : score}
      </div>
      <div className="metric-note">/ 100</div>
    </div>
  );
}
function LabTile({
  label,
  m,
  unit,
}: {
  label: string;
  m: { displayValue: string | null; score: number | null };
  unit: string;
}) {
  void unit;
  const col =
    m.score === null
      ? "var(--text-faint)"
      : m.score >= 0.9
        ? "var(--good)"
        : m.score >= 0.5
          ? "var(--warn)"
          : "var(--bad)";
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={{ color: col, fontSize: 22 }}>
        {m.displayValue || "—"}
      </div>
    </div>
  );
}
function FieldTile({ label, cat }: { label: string; cat: string | null }) {
  const map: Record<string, string> = {
    FAST: "var(--good)",
    AVERAGE: "var(--warn)",
    SLOW: "var(--bad)",
  };
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div
        className="metric-value"
        style={{
          fontSize: 18,
          color: cat ? map[cat] || "var(--text)" : "var(--text-faint)",
        }}
      >
        {cat || "—"}
      </div>
    </div>
  );
}

/* ------- Links & Images ------- */

function LinksImages({ audit }: { audit: AuditResult }) {
  const broken = audit.crawl.brokenLinks;
  const imgNoAlt = audit.pages.flatMap((p) =>
    p.images
      .filter((i) => i.alt === null)
      .map((i) => ({ page: p.url, src: i.src })),
  );
  const totalImages = audit.pages.reduce((n, p) => n + p.images.length, 0);
  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Metric
          label="Broken links"
          value={String(broken.length)}
          note="4xx / 5xx / network"
        />
        <Metric
          label="Images"
          value={String(totalImages)}
          note="across crawled pages"
        />
        <Metric
          label="Missing alt"
          value={String(imgNoAlt.length)}
          note="accessibility + SEO"
        />
        <Metric
          label="External links"
          value={String(
            audit.pages.reduce((n, p) => n + p.externalLinkCount, 0),
          )}
          note="outbound"
        />
      </div>
      <div className="section-title">Broken links</div>
      {broken.length === 0 ? (
        <div className="notice ok">
          No broken links detected in the sampled set.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Target</th>
                <th>Anchor</th>
                <th>Found on</th>
              </tr>
            </thead>
            <tbody>
              {broken.slice(0, 100).map((b, i) => (
                <tr key={i}>
                  <td>
                    <span className="badge sev-high">{b.status || "ERR"}</span>
                  </td>
                  <td className="u" title={b.to}>
                    {b.to}
                  </td>
                  <td
                    style={{
                      maxWidth: 180,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {b.anchor || "—"}
                  </td>
                  <td className="u" title={b.from}>
                    {new URL(b.from).pathname}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="section-title">Images missing alt text</div>
      {imgNoAlt.length === 0 ? (
        <div className="notice ok">
          Every crawled image has an alt attribute.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Image</th>
                <th>On page</th>
              </tr>
            </thead>
            <tbody>
              {imgNoAlt.slice(0, 100).map((im, i) => (
                <tr key={i}>
                  <td className="u" title={im.src}>
                    {im.src}
                  </td>
                  <td className="u" title={im.page}>
                    {new URL(im.page).pathname}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ------- AI Studio ------- */

interface ModelsResponse {
  configuredProviders: string[];
  hasAnyProvider: boolean;
  catalog: {
    id: ProviderId;
    label: string;
    needsKey: boolean;
    hasEnvKey: boolean;
    defaultModel: string;
    defaultBaseUrl: string;
  }[];
  freeModels: { id: string; label: string; contextLength?: number }[];
  freeModelCount: number;
}

function AiStudio({
  settings,
  onOpenSettings,
  audit,
}: {
  settings: AiSettings;
  onOpenSettings: (tab: "connections" | "crawl") => void;
  audit: AuditResult | null;
}) {
  const [tab, setTab] = useState<"overview" | "explorer" | "mule">(
    settings.connections.length ? "mule" : "overview",
  );
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>AI Studio</h3>
        <div className="sub">
          Bring your own key for any provider — OpenRouter, OpenAI, Anthropic,
          Google, Groq, a custom OpenAI-compatible endpoint, or a local
          Ollama/LM Studio server. Keys you add here live only in this browser
          and are sent directly with each request — never stored on our servers.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn sm"
            onClick={() => onOpenSettings("connections")}
          >
            + Add / manage connections
          </button>
          <span className="chip">
            {settings.connections.length} connection
            {settings.connections.length === 1 ? "" : "s"} saved
          </span>
          {data && (
            <span className="chip">
              {data.configuredProviders.length} provider
              {data.configuredProviders.length === 1 ? "" : "s"} configured via
              server env
            </span>
          )}
        </div>
      </div>

      <div className="tabbar">
        <button
          className={tab === "overview" ? "active" : ""}
          onClick={() => setTab("overview")}
        >
          Providers
        </button>
        <button
          className={tab === "explorer" ? "active" : ""}
          onClick={() => setTab("explorer")}
        >
          Model explorer
        </button>
        <button
          className={tab === "mule" ? "active" : ""}
          onClick={() => setTab("mule")}
        >
          Mule chat
        </button>
      </div>

      {tab === "overview" &&
        (loading ? (
          <div className="empty">
            <span className="spinner" /> Loading provider catalogue…
          </div>
        ) : (
          <>
            <div className="grid cols-3">
              {data?.catalog.map((p) => {
                const byok = settings.connections.filter(
                  (c) => c.provider === p.id,
                );
                return (
                  <div className="metric" key={p.id}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div className="metric-label">{p.label}</div>
                      {p.hasEnvKey ? (
                        <span
                          className="badge sev-low"
                          style={{
                            background: "rgba(52,211,153,0.15)",
                            color: "var(--good)",
                          }}
                        >
                          env key active
                        </span>
                      ) : byok.length ? (
                        <span
                          className="badge sev-low"
                          style={{
                            background: "rgba(91,140,255,0.15)",
                            color: "var(--brand-2)",
                          }}
                        >
                          {byok.length} BYOK
                        </span>
                      ) : (
                        <span className="chip">not configured</span>
                      )}
                    </div>
                    <div className="metric-note" style={{ marginTop: 8 }}>
                      {PROVIDER_META[p.id]?.hint} Default:{" "}
                      <code>{p.defaultModel || "—"}</code>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="section-title">
              Free models discovered on OpenRouter · {data?.freeModelCount ?? 0}
            </div>
            {data && data.freeModels.length > 0 ? (
              <div
                className="card"
                style={{ maxHeight: 320, overflowY: "auto" }}
              >
                {data.freeModels.slice(0, 80).map((m) => (
                  <div className="kv" key={m.id}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>
                      {m.id}
                    </span>
                    <span className="muted">
                      {m.contextLength
                        ? `${(m.contextLength / 1000).toFixed(0)}k ctx`
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="notice">
                No free models discovered yet — add an OpenRouter connection (a
                key is optional for listing) in Settings.
              </div>
            )}
          </>
        ))}

      {tab === "explorer" && <ModelExplorer settings={settings} />}
      {tab === "mule" && <Mule settings={settings} audit={audit} />}
    </>
  );
}

function ModelExplorer({ settings }: { settings: AiSettings }) {
  const [connId, setConnId] = useState<string>(
    settings.connections[0]?.id || "",
  );
  const [models, setModels] = useState<
    { id: string; label: string; contextLength?: number; free?: boolean }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    latencyMs: number;
  } | null>(null);
  const [filter, setFilter] = useState("");

  const conn = settings.connections.find((c) => c.id === connId);

  const discover = async () => {
    if (!conn) return;
    setLoading(true);
    setErr("");
    setModels([]);
    try {
      const res = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toCredential(conn)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not list models.");
      setModels(data.models || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not list models.");
    } finally {
      setLoading(false);
    }
  };

  const test = async () => {
    if (!conn) return;
    setTestResult(null);
    try {
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toCredential(conn)),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (e) {
      setTestResult({
        ok: false,
        message: e instanceof Error ? e.message : "Test failed.",
        latencyMs: 0,
      });
    }
  };

  const shown = models.filter(
    (m) => !filter || m.id.toLowerCase().includes(filter.toLowerCase()),
  );

  if (!settings.connections.length) {
    return (
      <div className="notice">
        Add a connection first (sidebar → AI connections &amp; BYOK) to browse
        and test its live model list.
      </div>
    );
  }

  return (
    <>
      <div className="runbar">
        <div className="field" style={{ flex: 1 }}>
          <label>Connection</label>
          <select
            value={connId}
            onChange={(e) => {
              setConnId(e.target.value);
              setModels([]);
              setTestResult(null);
            }}
          >
            {settings.connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({PROVIDER_META[c.provider]?.label})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>&nbsp;</label>
          <button className="btn sm" onClick={discover} disabled={loading}>
            {loading ? "Discovering…" : "Discover models"}
          </button>
        </div>
        <div className="field">
          <label>&nbsp;</label>
          <button className="btn ghost sm" onClick={test}>
            Test connection
          </button>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Filter</label>
          <input
            type="text"
            placeholder="filter model ids…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>
      {testResult && (
        <div
          className={`notice ${testResult.ok ? "ok" : "bad"}`}
          style={{ marginBottom: 14 }}
        >
          <span className={`dot ${testResult.ok ? "ok" : "bad"}`} />
          {testResult.message} ({testResult.latencyMs}ms)
        </div>
      )}
      {err && (
        <div className="notice bad" style={{ marginBottom: 14 }}>
          {err}
        </div>
      )}
      {shown.length > 0 ? (
        <div className="card" style={{ maxHeight: 420, overflowY: "auto" }}>
          {shown.map((m) => (
            <div className="kv" key={m.id}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                {m.id}{" "}
                {m.free && (
                  <span className="chip" style={{ marginLeft: 6 }}>
                    free
                  </span>
                )}
              </span>
              <span className="muted">
                {m.contextLength
                  ? `${(m.contextLength / 1000).toFixed(0)}k ctx`
                  : ""}
              </span>
            </div>
          ))}
        </div>
      ) : (
        !loading && (
          <div className="empty">
            Click &quot;Discover models&quot; to fetch the live list for this
            connection.
          </div>
        )
      )}
    </>
  );
}

/* ------- Mule (free-form chat, any configured LLM) ------- */

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

function Mule({
  settings,
  audit,
}: {
  settings: AiSettings;
  audit: AuditResult | null;
}) {
  const options = useMemo(() => {
    const list = settings.connections.map((c) => ({
      id: c.id,
      label: `${c.label} (${PROVIDER_META[c.provider]?.label})`,
    }));
    return list;
  }, [settings.connections]);
  const [connId, setConnId] = useState(
    settings.routing.chat ||
      settings.defaultConnectionId ||
      options[0]?.id ||
      "",
  );
  const [includeContext, setIncludeContext] = useState(!!audit);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({
      top: logRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, sending]);

  const conn = settings.connections.find((c) => c.id === connId);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const next = [...turns, { role: "user" as const, content: text }];
    setTurns(next);
    setInput("");
    setSending(true);
    setErr("");
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          credential: toCredential(conn),
          auditContext:
            includeContext && audit
              ? {
                  url: audit.crawl.origin,
                  health: audit.health,
                  crawl: audit.crawl,
                  topOpportunities: audit.opportunities.slice(0, 10),
                }
              : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Mule failed to respond.");
      setTurns((t) => [...t, { role: "assistant", content: data.text }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Mule failed to respond.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="runbar">
        <div className="field" style={{ flex: 1 }}>
          <label>Connection</label>
          {options.length ? (
            <select value={connId} onChange={(e) => setConnId(e.target.value)}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>
              Using server-configured provider (no BYOK connection saved)
            </span>
          )}
        </div>
        <div className="field">
          <label>&nbsp;</label>
          <div className="toggle-row" style={{ padding: 0 }}>
            <input
              type="checkbox"
              checked={includeContext}
              disabled={!audit}
              onChange={(e) => setIncludeContext(e.target.checked)}
            />
            <span className="label" style={{ marginLeft: 6 }}>
              Ground in current audit
            </span>
          </div>
        </div>
        <div className="field" style={{ flex: 1, justifyContent: "flex-end" }}>
          <button
            className="btn ghost sm"
            onClick={() => setTurns([])}
            disabled={!turns.length}
          >
            Clear chat
          </button>
        </div>
      </div>
      <div className="chat-shell">
        <div className="chat-log" ref={logRef}>
          {turns.length === 0 && (
            <div className="chat-empty">
              This is Mule — your own LLM, wired to whatever provider and model
              you&apos;ve configured.
              <br />
              Ask it about your audit, get it to draft a fix, or just chat.
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={`chat-msg ${t.role}`}>
              {t.content}
            </div>
          ))}
          {sending && (
            <div className="chat-msg assistant">
              <span className="spinner" />
              thinking…
            </div>
          )}
        </div>
        <div className="chat-input-row">
          <textarea
            placeholder="Ask Mule anything…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            className="btn"
            onClick={send}
            disabled={sending || !input.trim()}
          >
            Send
          </button>
        </div>
      </div>
      {err && (
        <div className="notice bad" style={{ marginTop: 12 }}>
          {err}
        </div>
      )}
    </>
  );
}

/* ------- Settings modal (BYOK connections + crawl defaults) ------- */

function SettingsModal({
  settings,
  initialTab,
  onClose,
  onChange,
}: {
  settings: AiSettings;
  initialTab: "connections" | "crawl";
  onClose: () => void;
  onChange: (next: AiSettings) => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [editing, setEditing] = useState<AiConnection | null>(null);

  const startNew = () => {
    setEditing({
      id: newId(),
      label: "",
      provider: "openrouter",
      apiKey: "",
      baseUrl: "",
      model: "",
      createdAt: new Date().toISOString(),
    });
  };

  const saveConn = (c: AiConnection) => {
    onChange(upsertConnection(settings, c));
    setEditing(null);
  };

  const deleteConn = (id: string) => {
    onChange(removeConnectionFromSettings(settings, id));
  };

  const setDefault = (id: string) => {
    onChange({ ...settings, defaultConnectionId: id });
  };

  const setRouting = (task: AiTask, id: string) => {
    onChange({
      ...settings,
      routing: { ...settings.routing, [task]: id || undefined },
    });
  };

  const setCrawl = (patch: Partial<AiSettings["crawlDefaults"]>) => {
    onChange({
      ...settings,
      crawlDefaults: { ...settings.crawlDefaults, ...patch },
    });
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal">
        <div className="modal-header">
          <h3>Settings</h3>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-tabs">
          <button
            className={tab === "connections" ? "active" : ""}
            onClick={() => setTab("connections")}
          >
            AI connections (BYOK)
          </button>
          <button
            className={tab === "crawl" ? "active" : ""}
            onClick={() => setTab("crawl")}
          >
            Crawl defaults
          </button>
        </div>
        <div className="modal-body">
          {tab === "connections" &&
            (editing ? (
              <ConnectionForm
                value={editing}
                onCancel={() => setEditing(null)}
                onSave={saveConn}
              />
            ) : (
              <>
                <p
                  className="muted"
                  style={{ fontSize: 12.5, marginBottom: 12 }}
                >
                  Keys are stored only in this browser (localStorage) and sent
                  directly with each AI request — never persisted on our
                  servers, never logged. Add any provider: cloud APIs with your
                  own key, a custom OpenAI-compatible endpoint, or a local
                  Ollama / LM Studio server.
                </p>
                <button
                  className="btn sm"
                  onClick={startNew}
                  style={{ marginBottom: 14 }}
                >
                  + Add connection
                </button>
                {settings.connections.length === 0 ? (
                  <div className="empty">
                    No connections yet. Server env vars (if set) are used as a
                    fallback.
                  </div>
                ) : (
                  <div className="conn-list">
                    {settings.connections.map((c) => (
                      <div className="conn-card" key={c.id}>
                        <div className="conn-head">
                          <div>
                            <span className="dot unknown" />
                            <span className="conn-name">
                              {c.label || "Untitled connection"}
                            </span>{" "}
                            <span className="conn-provider">
                              {PROVIDER_META[c.provider]?.label} ·{" "}
                              {c.model || "default model"}
                            </span>
                            {settings.defaultConnectionId === c.id && (
                              <span className="chip" style={{ marginLeft: 8 }}>
                                default
                              </span>
                            )}
                          </div>
                          <div className="conn-actions">
                            {settings.defaultConnectionId !== c.id && (
                              <button
                                className="btn ghost sm"
                                onClick={() => setDefault(c.id)}
                              >
                                Make default
                              </button>
                            )}
                            <button
                              className="btn ghost sm"
                              onClick={() => setEditing(c)}
                            >
                              Edit
                            </button>
                            <button
                              className="btn ghost sm"
                              onClick={() => deleteConn(c.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {settings.connections.length > 0 && (
                  <>
                    <div className="section-title">Task routing</div>
                    <p
                      className="muted"
                      style={{ fontSize: 12, marginBottom: 8 }}
                    >
                      Optionally send specific tasks to specific connections.
                      Falls back to your default.
                    </p>
                    <div className="form-grid">
                      {(["explain", "fix", "summary", "chat"] as AiTask[]).map(
                        (task) => (
                          <div className="form-row" key={task}>
                            <label>{task}</label>
                            <select
                              value={settings.routing[task] || ""}
                              onChange={(e) => setRouting(task, e.target.value)}
                            >
                              <option value="">Use default</option>
                              {settings.connections.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        ),
                      )}
                    </div>
                  </>
                )}
              </>
            ))}

          {tab === "crawl" && (
            <>
              <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
                These are the defaults every audit uses beyond the quick
                &quot;max pages&quot; control on the toolbar. There is no fixed
                page cap in this product — raise it as high as your target site
                (and your patience for a single ~50s serverless run) allows; a
                crawl always stops cleanly and reports &quot;truncated&quot;
                instead of failing.
              </p>
              <div className="form-grid">
                <div className="form-row">
                  <label>
                    Default max pages ({CRAWL_LIMITS.maxPages} ceiling)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={CRAWL_LIMITS.maxPages}
                    value={settings.crawlDefaults.maxPages}
                    onChange={(e) =>
                      setCrawl({
                        maxPages: Math.max(
                          1,
                          Math.min(
                            CRAWL_LIMITS.maxPages,
                            Number(e.target.value) || 1,
                          ),
                        ),
                      })
                    }
                  />
                </div>
                <div className="form-row">
                  <label>
                    Max crawl depth ({CRAWL_LIMITS.maxDepth} ceiling)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={CRAWL_LIMITS.maxDepth}
                    value={settings.crawlDefaults.maxDepth}
                    onChange={(e) =>
                      setCrawl({
                        maxDepth: Math.max(
                          0,
                          Math.min(
                            CRAWL_LIMITS.maxDepth,
                            Number(e.target.value) || 0,
                          ),
                        ),
                      })
                    }
                  />
                </div>
                <div className="form-row">
                  <label>
                    Concurrency ({CRAWL_LIMITS.concurrency} ceiling)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={CRAWL_LIMITS.concurrency}
                    value={settings.crawlDefaults.concurrency}
                    onChange={(e) =>
                      setCrawl({
                        concurrency: Math.max(
                          1,
                          Math.min(
                            CRAWL_LIMITS.concurrency,
                            Number(e.target.value) || 1,
                          ),
                        ),
                      })
                    }
                  />
                </div>
              </div>
              <div className="toggle-row">
                <span className="label">Respect robots.txt</span>
                <input
                  type="checkbox"
                  checked={settings.crawlDefaults.respectRobots}
                  onChange={(e) =>
                    setCrawl({ respectRobots: e.target.checked })
                  }
                />
              </div>
              <div className="toggle-row">
                <span className="label">
                  Check external links for broken targets
                </span>
                <input
                  type="checkbox"
                  checked={settings.crawlDefaults.checkExternalLinks}
                  onChange={(e) =>
                    setCrawl({ checkExternalLinks: e.target.checked })
                  }
                />
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn ghost sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectionForm({
  value,
  onCancel,
  onSave,
}: {
  value: AiConnection;
  onCancel: () => void;
  onSave: (c: AiConnection) => void;
}) {
  const [c, setC] = useState<AiConnection>(value);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    latencyMs: number;
  } | null>(null);
  const meta = PROVIDER_META[c.provider];

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: c.provider,
          apiKey: c.apiKey,
          baseUrl: c.baseUrl,
          model: c.model,
        }),
      });
      const data = await res.json();
      setTestResult(data);
      setC((cur) => ({
        ...cur,
        lastTestedAt: new Date().toISOString(),
        lastTestOk: data.ok,
        lastTestMessage: data.message,
      }));
    } catch (e) {
      setTestResult({
        ok: false,
        message: e instanceof Error ? e.message : "Test failed.",
        latencyMs: 0,
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <div className="form-grid">
        <div className="form-row">
          <label>Provider</label>
          <select
            value={c.provider}
            onChange={(e) => {
              const provider = e.target.value as AiConnection["provider"];
              const m = PROVIDER_META[provider];
              setC((cur) => ({
                ...cur,
                provider,
                baseUrl: m?.localDefault || cur.baseUrl,
              }));
            }}
          >
            {Object.entries(PROVIDER_META).map(([id, m]) => (
              <option key={id} value={id}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="hint">{meta?.hint}</span>
        </div>
        <div className="form-row">
          <label>Label</label>
          <input
            type="text"
            placeholder="e.g. My OpenRouter key"
            value={c.label}
            onChange={(e) => setC({ ...c, label: e.target.value })}
          />
        </div>
        <div className="form-row">
          <label>API key {meta?.needsKey ? "" : "(optional)"}</label>
          <input
            type="password"
            placeholder={meta?.needsKey ? "required" : "leave blank if none"}
            value={c.apiKey || ""}
            onChange={(e) => setC({ ...c, apiKey: e.target.value })}
          />
        </div>
        <div className="form-row">
          <label>Base URL override (optional)</label>
          <input
            type="text"
            placeholder={
              c.provider === "custom"
                ? "https://your-endpoint/v1"
                : "leave blank for default"
            }
            value={c.baseUrl || ""}
            onChange={(e) => setC({ ...c, baseUrl: e.target.value })}
          />
        </div>
        <div className="form-row" style={{ gridColumn: "1 / -1" }}>
          <label>Model (optional — leave blank for provider default)</label>
          <input
            type="text"
            placeholder="e.g. gpt-4o-mini, claude-3-5-haiku-latest, llama3.2"
            value={c.model || ""}
            onChange={(e) => setC({ ...c, model: e.target.value })}
          />
        </div>
      </div>
      {testResult && (
        <div
          className={`notice ${testResult.ok ? "ok" : "bad"}`}
          style={{ marginTop: 12 }}
        >
          <span className={`dot ${testResult.ok ? "ok" : "bad"}`} />
          {testResult.message} ({testResult.latencyMs}ms)
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <button
          className="btn sm"
          onClick={() => onSave(c)}
          disabled={!c.label.trim()}
        >
          Save connection
        </button>
        <button className="btn ghost sm" onClick={runTest} disabled={testing}>
          {testing ? "Testing…" : "Test connection"}
        </button>
        <button className="btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ------- Roadmap ------- */

function Roadmap() {
  const done = [
    "Multi-page crawler (BFS, robots.txt, sitemap, SSRF-hardened)",
    "Evidence capture for every page",
    "40+ deterministic rules across 9 categories",
    "Opportunity engine with severity × scope × ease scoring",
    "Health scoring by category",
    "Real Core Web Vitals via Google PageSpeed",
    "Evidence-grounded AI explain + fix playbooks (BYOK, any provider)",
    "Configurable crawl limits — no fixed page cap",
    "Full BYOK: custom endpoints, local Ollama/LM Studio, live model discovery, connection testing",
    "Mule: free-form chat assistant grounded in the current audit",
  ];
  const next = [
    "Durable queue + independent crawler workers (100k+ URLs)",
    "Supabase persistence, projects, and immutable audit history",
    "Before/after audit comparison and regression alerts",
    "Fix Center with Jira / GitHub actions and approval workflow",
    "Scheduled monitoring and notifications",
    "OAuth integrations: Search Console, GA4",
    "Ecommerce (Magento/Shopify) rule packs",
  ];
  return (
    <div className="grid cols-2">
      <div className="card">
        <h3>Shipped in this build</h3>
        <div className="sub">Everything here runs live on Vercel</div>
        {done.map((d) => (
          <div className="kv" key={d}>
            <span style={{ color: "var(--good)" }}>✓</span>
            <span style={{ color: "var(--text)", textAlign: "right" }}>
              {d}
            </span>
          </div>
        ))}
      </div>
      <div className="card">
        <h3>Production roadmap</h3>
        <div className="sub">
          Requires cloud workers &amp; a database — the honest next phases
        </div>
        {next.map((d) => (
          <div className="kv" key={d}>
            <span className="muted">○</span>
            <span style={{ textAlign: "right" }}>{d}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
