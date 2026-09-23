// Orchestrates a full audit: crawl -> deterministic rules -> health score ->
// opportunity aggregation -> summary counts. Pure application logic, no HTTP.

import { crawlSite, type CrawlOptions } from "./crawler";
import { runRules } from "./rules";
import { runIntelligenceRules } from "./intelligence";
import { computeHealth } from "./score";
import { buildOpportunities } from "./opportunities";
import type { AuditResult, Finding } from "./types";

export const AUDIT_ENGINE_VERSION = "1.1.0";

export async function runAudit(
  url: string,
  options: CrawlOptions = {},
): Promise<AuditResult> {
  const { stats, pages } = await crawlSite(url, options);
  const findings = [...runRules(pages, stats, url), ...runIntelligenceRules(pages)];
  const health = computeHealth(findings, stats.pagesCrawled);
  const opportunities = buildOpportunities(findings, stats.pagesCrawled);

  return {
    auditId: crypto.randomUUID(),
    version: AUDIT_ENGINE_VERSION,
    capturedAt: new Date().toISOString(),
    crawl: stats,
    health,
    pages,
    findings,
    opportunities,
    findingCountsByCategory: countBy(findings, (f) => f.category),
    findingCountsBySeverity: countBy(findings, (f) => f.severity),
  };
}

function countBy(findings: Finding[], key: (f: Finding) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) out[key(f)] = (out[key(f)] || 0) + 1;
  return out;
}
