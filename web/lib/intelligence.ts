// Evidence-only cross-page intelligence. Never infer an error for a URL that
// was not fetched: a bounded/partial crawl is not a complete site inventory.
import type { Finding, FindingCategory, PageEvidence, Severity } from "./types";

const RULE_VERSION = "1.0";

function issue(
  source: PageEvidence,
  ruleId: string,
  category: FindingCategory,
  severity: Severity,
  title: string,
  detail: string,
  why: string,
  recommendation: string,
  targets: string[],
): Finding {
  const finding: Finding = {
    ruleId,
    ruleVersion: RULE_VERSION,
    category,
    severity,
    title,
    detail,
    why,
    recommendation,
    url: source.url,
    evidence: targets.sort().slice(0, 5).join("\n"),
  };
  source.findings.push(finding);
  return finding;
}

function comparable(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href.replace(/\/$/, "");
  } catch {
    return url;
  }
}

/** Add actionable cross-page findings only when the referenced page was crawled. */
export function runIntelligenceRules(pages: PageEvidence[]): Finding[] {
  const findings: Finding[] = [];
  const known = new Map<string, PageEvidence>();
  for (const page of pages) {
    known.set(comparable(page.url), page);
    known.set(comparable(page.requestedUrl), page);
  }

  for (const source of pages) {
    if (!source.ok || !source.contentType.includes("html")) continue;
    const noindex = new Set<string>();
    const redirected = new Set<string>();
    const mixedImages = new Set<string>();
    for (const link of source.links) {
      if (!link.internal || !/^https?:\/\//i.test(link.href)) continue;
      const target = known.get(comparable(link.href));
      if (!target || target === source || !target.ok) continue;
      if (target.redirected && comparable(target.requestedUrl) === comparable(link.href)) {
        redirected.add(link.href);
      } else if (target.status < 400 && !target.indexable) {
        noindex.add(link.href);
      }
    }
    if (source.url.startsWith("https://")) {
      for (const image of source.images) {
        if (image.src.startsWith("http://")) mixedImages.add(image.src);
      }
    }
    if (noindex.size) {
      findings.push(issue(source, "LINK-NOINDEX-TARGET", "links", "medium", "Internal links point to noindex pages",
        `${noindex.size} internal target(s) were fetched successfully but excluded from indexing.`,
        "Prominent links to excluded pages can waste crawl budget and confuse site navigation.",
        "Confirm the exclusion is intentional; otherwise make the target indexable or update the links.", [...noindex]));
    }
    if (redirected.size) {
      findings.push(issue(source, "LINK-REDIRECT-TARGET", "links", "low", "Internal links point to redirects",
        `${redirected.size} internal target(s) redirect before loading.`,
        "Unnecessary redirects add latency for visitors and crawlers.",
        "Point links directly to the final destination.", [...redirected]));
    }
    if (mixedImages.size) {
      findings.push(issue(source, "IMG-MIXED-CONTENT", "security", "medium", "HTTP images on an HTTPS page",
        `${mixedImages.size} image URL(s) use HTTP on this HTTPS page.`,
        "Insecure asset requests may be upgraded or blocked and can expose users to tampering.",
        "Serve these images via HTTPS and update their references.", [...mixedImages]));
    }
    if (source.canonical) {
      const target = known.get(comparable(source.canonical));
      if (target && target !== source && (!target.ok || target.status >= 400)) {
        findings.push(issue(source, "CANONICAL-BROKEN-TARGET", "indexability", "high", "Canonical points to a failed page",
          `The canonical target returned HTTP ${target.status || "fetch failure"}.`,
          "A failed canonical target can prevent the preferred URL from being indexed.",
          "Point the canonical to a successful, indexable destination.", [source.canonical]));
      }
    }
    const hreflang = new Map<string, Set<string>>();
    for (const alternate of source.hreflang) {
      if (!alternate.lang || !/^https?:\/\//i.test(alternate.href)) continue;
      const lang = alternate.lang.toLowerCase();
      if (!hreflang.has(lang)) hreflang.set(lang, new Set());
      hreflang.get(lang)!.add(comparable(alternate.href));
    }
    const conflicts = [...hreflang.entries()].filter(([, urls]) => urls.size > 1);
    if (conflicts.length) {
      findings.push(issue(source, "HREFLANG-CONFLICT", "seo", "medium", "Conflicting hreflang targets",
        `${conflicts.length} language code(s) point to multiple destinations.`,
        "Conflicting alternate URLs make language selection ambiguous to crawlers.",
        "Keep one destination per language code on this page.",
        conflicts.map(([lang, urls]) => `${lang}: ${[...urls].sort().join(", ")}`)));
    }
  }
  return findings;
}
