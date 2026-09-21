// Opportunity engine: roll individual findings up by rule into prioritized
// actions. Instead of showing 2,000 "missing alt" errors, we show ONE
// opportunity affecting 2,000 images, scored by severity x scope x ease.

import type { Finding, Opportunity, Severity } from "./types";
import { SEVERITY_WEIGHT } from "./types";

// Rough remediation effort per rule. Anything not listed defaults to "medium".
const EFFORT: Record<string, "low" | "medium" | "high"> = {
  "SEO-TITLE-MISSING": "low",
  "SEO-TITLE-LONG": "low",
  "SEO-TITLE-SHORT": "low",
  "SEO-META-MISSING": "low",
  "SEO-META-LONG": "low",
  "SEO-H1-MISSING": "low",
  "SEO-H1-MULTIPLE": "low",
  "IMG-ALT-MISSING": "low",
  "A11Y-LANG": "low",
  "MOBILE-VIEWPORT": "low",
  "CANONICAL-MISSING": "low",
  "SEC-HSTS": "low",
  "SEC-XCTO": "low",
  "SEC-CSP": "medium",
  "IMG-DIMENSIONS": "medium",
  "IMG-LAZY": "low",
  "REDIRECT-CHAIN": "medium",
  "DUP-TITLE": "medium",
  "DUP-META": "medium",
  "DUP-CONTENT": "high",
  "CONTENT-THIN": "high",
  "ORPHAN": "medium",
  "STATUS-4XX": "high",
  "STATUS-5XX": "high",
  "LINK-BROKEN-INTERNAL": "medium",
  "LINK-BROKEN-EXTERNAL": "low",
  "NOINDEX": "low",
  "SD-MISSING": "medium",
  "SD-INVALID": "medium",
};

const EFFORT_FACTOR = { low: 1.0, medium: 0.85, high: 0.7 };

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export function buildOpportunities(
  findings: Finding[],
  pagesCrawled: number,
): Opportunity[] {
  const pages = Math.max(pagesCrawled, 1);
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!groups.has(f.ruleId)) groups.set(f.ruleId, []);
    groups.get(f.ruleId)!.push(f);
  }

  const opportunities: Opportunity[] = [];
  for (const [ruleId, group] of groups) {
    const severity = group
      .map((f) => f.severity)
      .sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a])[0];
    const affectedUrls = [...new Set(group.map((f) => f.url))];
    const effort = EFFORT[ruleId] || "medium";

    const severityComponent = SEVERITY_WEIGHT[severity] / 100; // 0-1
    const scopeComponent = Math.min(1, affectedUrls.length / pages); // 0-1
    const confidence: "high" | "medium" | "low" =
      severity === "info" ? "medium" : "high";
    const confidenceFactor = confidence === "high" ? 1 : 0.8;

    const score = Math.max(
      1,
      Math.min(
        100,
        Math.round(
          100 *
            (0.62 * severityComponent + 0.38 * scopeComponent) *
            EFFORT_FACTOR[effort] *
            confidenceFactor,
        ),
      ),
    );

    opportunities.push({
      id: ruleId,
      ruleId,
      category: group[0].category,
      severity,
      title: group[0].title,
      why: group[0].why,
      recommendation: group[0].recommendation,
      affectedUrls,
      affectedCount: affectedUrls.length,
      sampleEvidence: group
        .map((f) => f.evidence)
        .filter((e): e is string => Boolean(e))
        .slice(0, 4),
      score,
      effort,
      confidence,
    });
  }

  opportunities.sort((a, b) => b.score - a.score || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return opportunities;
}
