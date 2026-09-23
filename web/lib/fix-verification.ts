// A fix is verified only when a later complete crawl actually re-evaluated
// every previously affected URL and no longer observed this rule there.
export function verificationCoverage(
  baseline: { opportunities?: Array<{ id: string; affectedUrls: string[] }> },
  followup: {
    crawl?: { truncated?: boolean };
    pages?: Array<{ url: string; ok: boolean; status: number }>;
    findings?: Array<{ ruleId: string; url: string }>;
  },
  opportunityId: string,
): { valid: boolean; reason: string } {
  const opportunity = baseline.opportunities?.find((item) => item.id === opportunityId);
  if (!opportunity?.affectedUrls?.length)
    return { valid: false, reason: "The original opportunity was not found in the baseline audit." };
  if (followup.crawl?.truncated || !followup.pages || !followup.findings)
    return { valid: false, reason: "Verification requires a complete follow-up audit." };
  const pages = new Map(followup.pages.map((page) => [page.url, page]));
  for (const url of opportunity.affectedUrls) {
    const page = pages.get(url);
    if (!page?.ok || page.status < 200 || page.status >= 400)
      return { valid: false, reason: "The follow-up audit did not successfully recrawl every affected URL." };
    if (followup.findings.some((finding) => finding.ruleId === opportunityId && finding.url === url))
      return { valid: false, reason: "The finding still appears on an affected URL." };
  }
  return { valid: true, reason: "All affected URLs were recrawled without the finding." };
}
