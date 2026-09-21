"use client";

import { useCallback, useEffect, useState } from "react";
import { CATEGORY_LABELS } from "@/lib/types";
import type { AuditResult, Opportunity, Finding, PageEvidence, Severity } from "@/lib/types";
import type { PageSpeedResult } from "@/lib/pagespeed";

const MODULES = [
  "Overview",
  "Opportunities",
  "Findings",
  "Crawl",
  "Performance",
  "Links & Images",
  "AI Studio",
  "Roadmap",
] as const;
type Module = (typeof MODULES)[number];

const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

function sevClass(s: string) {
  return `badge sev-${s}`;
}
function scoreColor(n: number) {
  if (n >= 90) return "var(--good)";
  if (n >= 75) return "var(--brand-2)";
  if (n >= 50) return "var(--warn)";
  return "var(--bad)";
}
function gradeBg(n: number) {
  const c = scoreColor(n);
  return { color: c, background: `${c}22` };
}

export default function Home() {
  const [active, setActive] = useState<Module>("Overview");
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(20);
  const [running, setRunning] = useState(false);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [error, setError] = useState("");

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
        body: JSON.stringify({ url, maxPages }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Audit failed.");
      setAudit(data as AuditResult);
      setActive("Overview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audit failed.");
    } finally {
      setRunning(false);
    }
  }, [url, maxPages]);

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
                <span className={`pill ${counts[m] ? "" : "zero"}`}>{counts[m]}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-label" style={{ marginTop: 20 }}>Model</div>
        <div style={{ padding: "0 6px" }}>
          <div className="chip">Find → Explain → Prioritize → Fix → Verify</div>
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
              engine v{audit.version} · {new Date(audit.capturedAt).toLocaleString()}
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
            <label>Max pages · {maxPages}</label>
            <input
              type="range"
              min={1}
              max={50}
              value={maxPages}
              onChange={(e) => setMaxPages(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button className="btn" onClick={runAudit} disabled={running}>
              {running ? <><span className="spinner" />Crawling…</> : "Run audit"}
            </button>
          </div>
        </div>

        {error && <div className="notice bad" style={{ marginBottom: 16 }}>{error}</div>}

        {!audit && !running && <Welcome />}
        {running && !audit && (
          <div className="empty">
            <span className="spinner" /> Crawling the site, running the rules engine, and scoring…
          </div>
        )}

        {audit && active === "Overview" && <Overview audit={audit} onJump={setActive} />}
        {audit && active === "Opportunities" && <Opportunities audit={audit} />}
        {audit && active === "Findings" && <Findings audit={audit} />}
        {audit && active === "Crawl" && <Crawl audit={audit} />}
        {audit && active === "Performance" && <Performance origin={audit.crawl.requestedUrl} />}
        {audit && active === "Links & Images" && <LinksImages audit={audit} />}
        {active === "AI Studio" && <AiStudio />}
        {active === "Roadmap" && <Roadmap />}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Welcome() {
  return (
    <div className="card" style={{ padding: "26px 24px" }}>
      <h3 style={{ fontSize: 18 }}>Audit any public website in one pass</h3>
      <p className="muted" style={{ maxWidth: 640, marginTop: 6 }}>
        WebOps AI crawls the site, captures verifiable evidence for every page, runs a deterministic
        rules engine across SEO, indexability, content, links, images, structured data, accessibility
        and security, then rolls everything up into prioritized opportunities. Add a PageSpeed key for
        real Core Web Vitals and an AI key for evidence-grounded fix playbooks.
      </p>
      <div className="grid cols-4" style={{ marginTop: 18 }}>
        {[
          ["Real crawler", "BFS, robots.txt, sitemap, depth limits"],
          ["40+ rules", "Deterministic, reproducible, explained"],
          ["Core Web Vitals", "Lighthouse via Google, no local Chrome"],
          ["AI copilot", "Grounded in the evidence, never invented"],
        ].map(([t, s]) => (
          <div className="metric" key={t}>
            <div className="metric-label">{t}</div>
            <div className="metric-note" style={{ marginTop: 8 }}>{s}</div>
          </div>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 16, fontSize: 12.5 }}>
        Enter a URL above and press <b>Run audit</b>. Try <code>vercel.com</code> or your own site.
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
        <circle cx="66" cy="66" r={r} fill="none" stroke="var(--bg-2)" strokeWidth="12" />
        <circle
          cx="66" cy="66" r={r} fill="none" stroke={col} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off}
        />
      </svg>
      <div className="val">
        <b style={{ color: col }}>{score}</b>
        <span>Health · {grade}</span>
      </div>
    </div>
  );
}

function Overview({ audit, onJump }: { audit: AuditResult; onJump: (m: Module) => void }) {
  const { health, crawl, opportunities } = audit;
  const cats = Object.entries(health.categories) as [string, number][];
  const sevCounts = audit.findingCountsBySeverity;
  return (
    <>
      <div className="grid cols-2">
        <div className="card">
          <div className="score-hero">
            <Ring score={health.overall} grade={health.grade} />
            <div style={{ flex: 1 }}>
              <h3>Overall health</h3>
              <div className="sub">Importance-weighted across evaluated categories</div>
              {cats
                .sort((a, b) => a[1] - b[1])
                .map(([cat, score]) => (
                  <div className="cat-row" key={cat}>
                    <span className="name">{CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] || cat}</span>
                    <span className="bar"><span style={{ width: `${score}%`, background: scoreColor(score) }} /></span>
                    <span className="num">{score}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
        <div className="card">
          <h3>Findings by severity</h3>
          <div className="sub">{audit.findings.length} findings across {crawl.pagesCrawled} pages</div>
          {SEV_ORDER.map((s) => (
            <div className="cat-row" key={s}>
              <span className="name"><span className={sevClass(s)}>{s}</span></span>
              <span className="bar">
                <span
                  style={{
                    width: `${audit.findings.length ? ((sevCounts[s] || 0) / audit.findings.length) * 100 : 0}%`,
                    background: s === "critical" ? "var(--crit)" : s === "high" ? "var(--bad)" : s === "medium" ? "var(--warn)" : s === "low" ? "#7fb8ff" : "var(--text-faint)",
                  }}
                />
              </span>
              <span className="num">{sevCounts[s] || 0}</span>
            </div>
          ))}
          <div style={{ marginTop: 14 }}>
            <button className="btn ghost sm" onClick={() => onJump("Opportunities")}>View opportunities →</button>
          </div>
        </div>
      </div>

      <div className="section-title">Crawl summary</div>
      <div className="grid cols-4">
        <Metric label="Pages crawled" value={String(crawl.pagesCrawled)} note={`${crawl.pagesRequested} requested`} />
        <Metric label="Duration" value={`${(crawl.durationMs / 1000).toFixed(1)}s`} note={`depth ≤ ${crawl.maxDepth}`} />
        <Metric label="Broken links" value={String(crawl.brokenLinks.length)} note="internal + external" />
        <Metric
          label="robots / sitemap"
          value={`${crawl.robotsFound ? "✓" : "✗"} / ${crawl.sitemapFound ? "✓" : "✗"}`}
          note={crawl.fromSitemap ? `${crawl.fromSitemap} URLs from sitemap` : "no sitemap URLs"}
        />
      </div>

      <div className="section-title">Top opportunities</div>
      {opportunities.slice(0, 3).map((o) => (
        <OppCard key={o.id} opp={o} compact />
      ))}
      {opportunities.length > 3 && (
        <button className="btn ghost sm" onClick={() => onJump("Opportunities")}>
          See all {opportunities.length} opportunities →
        </button>
      )}
    </>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value blue">{value}</div>
      <div className="metric-note">{note}</div>
    </div>
  );
}

/* ------- Opportunities + AI ------- */

function Opportunities({ audit }: { audit: AuditResult }) {
  if (!audit.opportunities.length)
    return <div className="empty">No opportunities — the rules engine found nothing to fix. 🎉</div>;
  return (
    <>
      <p className="muted" style={{ marginBottom: 14 }}>
        {audit.opportunities.length} prioritized actions. Score = severity × scope × ease. Use the AI
        buttons to generate an evidence-grounded explanation or a step-by-step fix playbook.
      </p>
      {audit.opportunities.map((o) => (
        <OppCard key={o.id} opp={o} />
      ))}
    </>
  );
}

function OppCard({ opp, compact }: { opp: Opportunity; compact?: boolean }) {
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
        body: JSON.stringify({ mode, opportunity: opp }),
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
            <span className="chip">{opp.affectedCount} page{opp.affectedCount === 1 ? "" : "s"}</span>
            <span className="chip">effort: {opp.effort}</span>
            <span className="chip">confidence: {opp.confidence}</span>
          </div>
          <p><b>Why:</b> {opp.why}</p>
          <p><b>Fix:</b> {opp.recommendation}</p>
          {!compact && opp.sampleEvidence.length > 0 && (
            <p className="muted" style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>
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
          <button className="btn sm" onClick={() => ask("explain")} disabled={!!loading}>
            {loading === "explain" ? <><span className="spinner" />Explaining…</> : "Explain with AI"}
          </button>
          <button className="btn ghost sm" onClick={() => ask("fix")} disabled={!!loading}>
            {loading === "fix" ? <><span className="spinner" />Generating…</> : "Generate fix playbook"}
          </button>
        </div>
      )}
      {err && <div className="notice bad" style={{ marginTop: 10 }}>{err}</div>}
      {out && <div className="ai-out">{out}</div>}
    </div>
  );
}

/* ------- Findings ------- */

function Findings({ audit }: { audit: AuditResult }) {
  const [cat, setCat] = useState<string>("all");
  const cats = ["all", ...Object.keys(audit.findingCountsByCategory)];
  const shown = audit.findings
    .filter((f) => cat === "all" || f.category === cat)
    .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
  return (
    <>
      <div className="tabbar">
        {cats.map((c) => (
          <button key={c} className={cat === c ? "active" : ""} onClick={() => setCat(c)}>
            {c === "all" ? "All" : CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS] || c}
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
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span className={sevClass(f.severity)}>{f.severity}</span>
        <b style={{ fontSize: 13.5 }}>{f.title}</b>
        <span className="chip">{CATEGORY_LABELS[f.category]}</span>
        <span className="chip" style={{ fontFamily: "var(--mono)" }}>{f.ruleId}</span>
      </div>
      <p className="muted" style={{ margin: "7px 0 4px", fontSize: 12.5 }}>{f.detail}</p>
      <div className="kv"><span>Affected</span><span className="u" style={{ maxWidth: 420 }}>{f.url}</span></div>
      {f.evidence && (
        <div className="muted" style={{ fontFamily: "var(--mono)", fontSize: 11, marginTop: 6, whiteSpace: "pre-wrap" }}>
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
          <Metric key={k} label={`HTTP ${k}`} value={String(v)} note="responses" />
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Status</th><th>URL</th><th>Title</th><th>Words</th><th>Depth</th><th>Index</th><th>Issues</th>
            </tr>
          </thead>
          <tbody>
            {audit.pages.map((p: PageEvidence) => (
              <tr key={p.url}>
                <td>
                  <span
                    className="status-dot"
                    style={{ background: p.status >= 400 || p.status === 0 ? "var(--bad)" : p.redirected ? "var(--warn)" : "var(--good)" }}
                  />
                  {p.status || "ERR"}
                </td>
                <td className="u" title={p.url}>{new URL(p.url).pathname || "/"}</td>
                <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title || <span className="muted">—</span>}</td>
                <td>{p.wordCount || "—"}</td>
                <td>{p.depth}</td>
                <td>{p.indexable ? <span style={{ color: "var(--good)" }}>yes</span> : <span className="muted">{p.indexabilityReason || "no"}</span>}</td>
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
          <select value={strategy} onChange={(e) => setStrategy(e.target.value as "mobile" | "desktop")}>
            <option value="mobile">Mobile</option>
            <option value="desktop">Desktop</option>
          </select>
        </div>
        <div className="field">
          <label>&nbsp;</label>
          <button className="btn" onClick={run} disabled={loading}>
            {loading ? <><span className="spinner" />Measuring…</> : "Measure Core Web Vitals"}
          </button>
        </div>
        <div className="field" style={{ flex: 1, justifyContent: "flex-end" }}>
          <span className="muted" style={{ fontSize: 12 }}>
            Powered by Google PageSpeed Insights (Lighthouse). No local Chrome required.
          </span>
        </div>
      </div>
      {err && <div className="notice warn" style={{ marginBottom: 14 }}>{err}</div>}
      {!perf && !loading && <div className="empty">Run a measurement to see real Lighthouse scores and field data.</div>}
      {perf && (
        <>
          <div className="grid cols-4">
            <ScoreTile label="Performance" score={perf.scores.performance} />
            <ScoreTile label="Accessibility" score={perf.scores.accessibility} />
            <ScoreTile label="Best Practices" score={perf.scores.bestPractices} />
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
              <div className="section-title">Field data (real users · CrUX)</div>
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
                  <b>{o.displayValue || `${(o.savingsMs / 1000).toFixed(2)}s`}</b>
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
      <div className="metric-value" style={{ color: score === null ? "var(--text-faint)" : scoreColor(score) }}>
        {score === null ? "—" : score}
      </div>
      <div className="metric-note">/ 100</div>
    </div>
  );
}
function LabTile({ label, m, unit }: { label: string; m: { displayValue: string | null; score: number | null }; unit: string }) {
  void unit;
  const col = m.score === null ? "var(--text-faint)" : m.score >= 0.9 ? "var(--good)" : m.score >= 0.5 ? "var(--warn)" : "var(--bad)";
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={{ color: col, fontSize: 22 }}>{m.displayValue || "—"}</div>
    </div>
  );
}
function FieldTile({ label, cat }: { label: string; cat: string | null }) {
  const map: Record<string, string> = { FAST: "var(--good)", AVERAGE: "var(--warn)", SLOW: "var(--bad)" };
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={{ fontSize: 18, color: cat ? map[cat] || "var(--text)" : "var(--text-faint)" }}>
        {cat || "—"}
      </div>
    </div>
  );
}

/* ------- Links & Images ------- */

function LinksImages({ audit }: { audit: AuditResult }) {
  const broken = audit.crawl.brokenLinks;
  const imgNoAlt = audit.pages.flatMap((p) => p.images.filter((i) => i.alt === null).map((i) => ({ page: p.url, src: i.src })));
  const totalImages = audit.pages.reduce((n, p) => n + p.images.length, 0);
  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Metric label="Broken links" value={String(broken.length)} note="4xx / 5xx / network" />
        <Metric label="Images" value={String(totalImages)} note="across crawled pages" />
        <Metric label="Missing alt" value={String(imgNoAlt.length)} note="accessibility + SEO" />
        <Metric
          label="External links"
          value={String(audit.pages.reduce((n, p) => n + p.externalLinkCount, 0))}
          note="outbound"
        />
      </div>
      <div className="section-title">Broken links</div>
      {broken.length === 0 ? (
        <div className="notice ok">No broken links detected in the sampled set.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Status</th><th>Target</th><th>Anchor</th><th>Found on</th></tr></thead>
            <tbody>
              {broken.slice(0, 100).map((b, i) => (
                <tr key={i}>
                  <td><span className="badge sev-high">{b.status || "ERR"}</span></td>
                  <td className="u" title={b.to}>{b.to}</td>
                  <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.anchor || "—"}</td>
                  <td className="u" title={b.from}>{new URL(b.from).pathname}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="section-title">Images missing alt text</div>
      {imgNoAlt.length === 0 ? (
        <div className="notice ok">Every crawled image has an alt attribute.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Image</th><th>On page</th></tr></thead>
            <tbody>
              {imgNoAlt.slice(0, 100).map((im, i) => (
                <tr key={i}>
                  <td className="u" title={im.src}>{im.src}</td>
                  <td className="u" title={im.page}>{new URL(im.page).pathname}</td>
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
  catalog: { provider: string; label: string; tier: string; note: string }[];
  freeModels: { id: string; label: string; contextLength?: number }[];
  freeModelCount: number;
}

function AiStudio() {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="empty"><span className="spinner" /> Loading model catalogue…</div>;

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>AI Studio</h3>
        <div className="sub">Bring your own key. Keys live only in server-side environment variables — never in the browser, never logged.</div>
        {data?.hasAnyProvider ? (
          <div className="notice ok">
            Configured providers: <b>{data.configuredProviders.join(", ")}</b>. The Explain / Fix buttons on each opportunity are live.
          </div>
        ) : (
          <div className="notice warn">
            No AI provider configured yet. Add one of <code>OPENROUTER_API_KEY</code>, <code>OPENAI_API_KEY</code>,
            <code> ANTHROPIC_API_KEY</code>, <code>GROQ_API_KEY</code>, or <code>GOOGLE_API_KEY</code> in your Vercel
            environment variables, then redeploy.
          </div>
        )}
      </div>
      <div className="section-title">Providers</div>
      <div className="grid cols-3">
        {data?.catalog.map((p) => (
          <div className="metric" key={p.provider}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="metric-label">{p.label}</div>
              {data.configuredProviders.includes(p.provider) ? (
                <span className="badge sev-low" style={{ background: "rgba(52,211,153,0.15)", color: "var(--good)" }}>active</span>
              ) : (
                <span className="chip">not set</span>
              )}
            </div>
            <div className="metric-note" style={{ marginTop: 8 }}>{p.note}</div>
          </div>
        ))}
      </div>
      <div className="section-title">Free models discovered on OpenRouter · {data?.freeModelCount ?? 0}</div>
      {data && data.freeModels.length > 0 ? (
        <div className="card" style={{ maxHeight: 320, overflowY: "auto" }}>
          {data.freeModels.slice(0, 60).map((m) => (
            <div className="kv" key={m.id}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>{m.id}</span>
              <span className="muted">{m.contextLength ? `${(m.contextLength / 1000).toFixed(0)}k ctx` : ""}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="notice">Set <code>OPENROUTER_API_KEY</code> to discover the live list of free models.</div>
      )}
    </>
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
    "Evidence-grounded AI explain + fix playbooks (BYOK)",
    "Live free-model discovery",
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
          <div className="kv" key={d}><span style={{ color: "var(--good)" }}>✓</span><span style={{ color: "var(--text)", textAlign: "right" }}>{d}</span></div>
        ))}
      </div>
      <div className="card">
        <h3>Production roadmap</h3>
        <div className="sub">Requires cloud workers &amp; a database — the honest next phases</div>
        {next.map((d) => (
          <div className="kv" key={d}><span className="muted">○</span><span style={{ textAlign: "right" }}>{d}</span></div>
        ))}
      </div>
    </div>
  );
}
