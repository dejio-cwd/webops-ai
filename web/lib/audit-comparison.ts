import type { AuditResult, Finding } from "./types";

export type AuditComparison = {
  beforeAuditId: string;
  afterAuditId: string;
  beforeCapturedAt: string;
  afterCapturedAt: string;
  healthScoreDelta: number;
  pagesCrawledDelta: number;
  newFindings: Finding[];
  resolvedFindings: Finding[];
  unverifiedFindings: Finding[];
  persistentFindings: Finding[];
  regressions: Finding[];
};

function key(finding: Finding) {
  return `${finding.ruleId}|${finding.url}|${finding.evidence || ""}`;
}

export function compareAudits(
  before: AuditResult,
  after: AuditResult,
): AuditComparison {
  const beforeMap = new Map(
    before.findings.map((finding) => [key(finding), finding]),
  );
  const afterMap = new Map(
    after.findings.map((finding) => [key(finding), finding]),
  );
  const newFindings: Finding[] = [];
  const resolvedFindings: Finding[] = [];
  const unverifiedFindings: Finding[] = [];
  const covered = new Set((after.pages || []).filter(page => page.ok && !page.error).flatMap(page => [page.url, page.requestedUrl, page.finalUrl]));
  const persistentFindings: Finding[] = [];
  for (const [id, finding] of afterMap) {
    if (beforeMap.has(id)) persistentFindings.push(finding);
    else newFindings.push(finding);
  }
  for (const [id, finding] of beforeMap)
    if (!afterMap.has(id)) {
      // A missing observation is not evidence of a fix. Site-wide rules also
      // need a complete follow-up crawl to support a resolution claim.
      if (covered.has(finding.url) && !after.crawl.truncated) resolvedFindings.push(finding);
      else unverifiedFindings.push(finding);
    }
  return {
    beforeAuditId: before.auditId,
    afterAuditId: after.auditId,
    beforeCapturedAt: before.capturedAt,
    afterCapturedAt: after.capturedAt,
    healthScoreDelta: after.health.overall - before.health.overall,
    pagesCrawledDelta: after.crawl.pagesCrawled - before.crawl.pagesCrawled,
    newFindings,
    resolvedFindings,
    unverifiedFindings,
    persistentFindings,
    regressions: newFindings.filter(
      (finding) =>
        finding.severity === "critical" || finding.severity === "high",
    ),
  };
}
