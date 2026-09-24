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
  const persistentFindings: Finding[] = [];
  for (const [id, finding] of afterMap) {
    if (beforeMap.has(id)) persistentFindings.push(finding);
    else newFindings.push(finding);
  }
  for (const [id, finding] of beforeMap)
    if (!afterMap.has(id)) resolvedFindings.push(finding);
  return {
    beforeAuditId: before.auditId,
    afterAuditId: after.auditId,
    beforeCapturedAt: before.capturedAt,
    afterCapturedAt: after.capturedAt,
    healthScoreDelta: after.health.overall - before.health.overall,
    pagesCrawledDelta: after.crawl.pagesCrawled - before.crawl.pagesCrawled,
    newFindings,
    resolvedFindings,
    persistentFindings,
    regressions: newFindings.filter(
      (finding) =>
        finding.severity === "critical" || finding.severity === "high",
    ),
  };
}
