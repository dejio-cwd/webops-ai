// Deterministic rules engine. Every finding is reproducible from the same
// evidence, carries a stable ruleId + version, and explains itself. Rules span
// per-page checks and site-level checks (duplicates, orphans, broken links).

import type {
  PageEvidence,
  Finding,
  FindingCategory,
  Severity,
  CrawlStats,
} from "./types";
import { registrableHost } from "./normalize";

const V = "1.0";

interface Ctx {
  pages: PageEvidence[];
  crawl: CrawlStats;
  entryUrl: string;
  inlinks: Map<string, Set<string>>; // page -> set of pages linking to it
}

function mk(
  page: PageEvidence,
  ruleId: string,
  category: FindingCategory,
  severity: Severity,
  title: string,
  detail: string,
  why: string,
  recommendation: string,
  evidence?: string,
): Finding {
  const f: Finding = {
    ruleId,
    ruleVersion: V,
    category,
    severity,
    title,
    detail,
    why,
    recommendation,
    url: page.url,
    evidence,
  };
  page.findings.push(f);
  return f;
}

export function runRules(pages: PageEvidence[], crawl: CrawlStats, entryUrl: string): Finding[] {
  const findings: Finding[] = [];
  const inlinks = buildInlinkMap(pages);
  const ctx: Ctx = { pages, crawl, entryUrl, inlinks };

  for (const page of pages) {
    if (page.error && page.status === 0) {
      findings.push(
        mk(page, "FETCH-FAILED", "indexability", "high", "Page could not be fetched",
          `The crawler could not retrieve this URL (${page.error}).`,
          "Pages that fail to load are invisible to users and search engines.",
          "Confirm the URL is reachable, returns within timeout, and is not blocking bots.",
          page.error),
      );
      continue;
    }
    perPageRules(page, ctx, findings);
  }

  siteRules(ctx, findings);
  // newest/most severe implicitly ordered later by the aggregator.
  return findings;
}

function perPageRules(page: PageEvidence, ctx: Ctx, out: Finding[]) {
  const isHtml = page.contentType.includes("html");
  const push = (f: Finding) => out.push(f);

  // --- Indexability / status ---
  if (page.status >= 500) {
    push(mk(page, "STATUS-5XX", "indexability", "critical", "Server error (5xx)",
      `Returned HTTP ${page.status}.`,
      "Server errors break the page for every visitor and crawler.",
      "Investigate server logs and fix the underlying error."));
    return;
  }
  if (page.status >= 400) {
    push(mk(page, "STATUS-4XX", "indexability", "critical", "Broken page (4xx)",
      `Returned HTTP ${page.status}.`,
      "4xx pages waste crawl budget and frustrate users following links.",
      "Restore the page or 301-redirect it to a relevant live URL."));
    return;
  }
  if (page.redirectChain.length >= 2) {
    push(mk(page, "REDIRECT-CHAIN", "indexability", "medium", "Redirect chain",
      `This URL redirects ${page.redirectChain.length} times before resolving.`,
      "Redirect chains slow page loads and dilute link equity.",
      "Point the first URL directly at the final destination (single 301).",
      page.redirectChain.map((r) => `${r.status} ${r.url}`).join(" → ")));
  }
  if (page.robotsMeta?.includes("noindex") || page.xRobotsTag?.includes("noindex")) {
    const isEntry = registrableHost(new URL(page.url).hostname) === registrableHost(new URL(ctx.entryUrl).hostname) && page.depth === 0;
    push(mk(page, "NOINDEX", "indexability", isEntry ? "critical" : "medium",
      isEntry ? "Homepage is set to noindex" : "Page is set to noindex",
      `A noindex directive was found (${page.robotsMeta || page.xRobotsTag}).`,
      "Noindex removes the page from search results entirely.",
      isEntry ? "Remove noindex from the homepage immediately unless this is intentional." : "Confirm this page should be excluded from search; otherwise remove noindex.",
      page.robotsMeta || page.xRobotsTag || undefined));
  }

  if (!isHtml) return; // remaining rules are HTML-specific

  // --- Titles ---
  if (!page.title) {
    push(mk(page, "SEO-TITLE-MISSING", "seo", "high", "Missing page title",
      "No <title> element was found.",
      "The title is the single strongest on-page SEO signal and the clickable headline in search results.",
      "Add a unique, descriptive <title> of roughly 30-60 characters."));
  } else {
    if (page.titleLength > 60) {
      push(mk(page, "SEO-TITLE-LONG", "seo", "low", "Title too long",
        `Title is ${page.titleLength} characters and will likely be truncated in search results.`,
        "Truncated titles lose meaning and click-through.",
        "Trim the title to ~60 characters, front-loading the key phrase.",
        page.title));
    } else if (page.titleLength < 15) {
      push(mk(page, "SEO-TITLE-SHORT", "seo", "low", "Title very short",
        `Title is only ${page.titleLength} characters.`,
        "Short titles miss ranking and click-through opportunities.",
        "Expand to a descriptive ~30-60 character title.",
        page.title));
    }
  }

  // --- Meta description ---
  if (!page.metaDescription) {
    push(mk(page, "SEO-META-MISSING", "seo", "medium", "Missing meta description",
      "No meta description was found.",
      "The meta description is the snippet shown under the title in search results and drives click-through.",
      "Write a compelling 120-160 character description with the primary keyword."));
  } else if (page.metaDescriptionLength > 160) {
    push(mk(page, "SEO-META-LONG", "seo", "low", "Meta description too long",
      `Description is ${page.metaDescriptionLength} characters and will be truncated.`,
      "Truncated snippets cut off your message.",
      "Trim to ~155 characters.",
      page.metaDescription));
  }

  // --- Headings ---
  if (page.h1.length === 0) {
    push(mk(page, "SEO-H1-MISSING", "seo", "medium", "Missing H1 heading",
      "No <h1> element was found.",
      "The H1 tells users and search engines the page's main topic.",
      "Add exactly one descriptive H1."));
  } else if (page.h1.length > 1) {
    push(mk(page, "SEO-H1-MULTIPLE", "seo", "low", "Multiple H1 headings",
      `${page.h1.length} H1 elements were found.`,
      "Multiple H1s dilute the topical signal.",
      "Use a single H1 and demote the rest to H2/H3.",
      page.h1.slice(0, 3).join(" | ")));
  }
  if (page.headingOutlineIssues.length) {
    push(mk(page, "HEADING-OUTLINE", "accessibility", "low", "Broken heading outline",
      page.headingOutlineIssues.join("; ") + ".",
      "Screen-reader users navigate by heading level; skipped levels break that structure.",
      "Use heading levels sequentially without skipping."));
  }

  // --- Content ---
  if (page.indexable && page.wordCount < 200) {
    push(mk(page, "CONTENT-THIN", "content", "medium", "Thin content",
      `Only ${page.wordCount} words of body text.`,
      "Thin pages struggle to rank and may be seen as low value.",
      "Expand with genuinely useful content, or noindex if it is a utility page.",
      `${page.wordCount} words`));
  }
  if (isHtml && page.textToHtmlRatio > 0 && page.textToHtmlRatio < 0.08) {
    push(mk(page, "CONTENT-LOW-RATIO", "content", "info", "Low text-to-HTML ratio",
      `Text is only ${(page.textToHtmlRatio * 100).toFixed(1)}% of the HTML payload.`,
      "A very low ratio can indicate bloated markup slowing the page.",
      "Reduce inline markup/scripts or add substantive content."));
  }

  // --- Canonical ---
  if (page.indexable && !page.canonical) {
    push(mk(page, "CANONICAL-MISSING", "indexability", "low", "Missing canonical tag",
      "No rel=canonical link was found.",
      "Canonicals prevent duplicate-content dilution across URL variants.",
      "Add a self-referencing canonical tag."));
  } else if (page.canonical) {
    try {
      const cHost = registrableHost(new URL(page.canonical).hostname);
      const pHost = registrableHost(new URL(page.url).hostname);
      if (cHost !== pHost) {
        push(mk(page, "CANONICAL-EXTERNAL", "indexability", "medium", "Canonical points to another domain",
          `Canonical target is ${page.canonical}.`,
          "A cross-domain canonical tells search engines to index a different site.",
          "Confirm this is intentional; otherwise point the canonical to this domain.",
          page.canonical));
      } else if (stripSlash(page.canonical) !== stripSlash(page.url)) {
        push(mk(page, "CANONICALIZED", "indexability", "info", "Page canonicalizes elsewhere",
          `Canonical points to ${page.canonical} rather than this URL.`,
          "This page defers ranking to another URL.",
          "Verify the canonical target is correct.",
          page.canonical));
      }
    } catch { /* malformed canonical ignored */ }
  }

  // --- Images ---
  const noAlt = page.images.filter((i) => i.alt === null);
  if (noAlt.length) {
    push(mk(page, "IMG-ALT-MISSING", "accessibility", "high", "Images missing alt text",
      `${noAlt.length} of ${page.images.length} images have no alt attribute.`,
      "Alt text is required for screen-reader users and helps image SEO.",
      "Add descriptive alt text (or alt=\"\" for purely decorative images).",
      noAlt.slice(0, 3).map((i) => i.src).join(", ")));
  }
  const noDims = page.images.filter((i) => !i.width || !i.height);
  if (noDims.length >= 3) {
    push(mk(page, "IMG-DIMENSIONS", "performance", "low", "Images without dimensions",
      `${noDims.length} images lack explicit width/height.`,
      "Missing dimensions cause layout shift (poor CLS).",
      "Set width and height (or aspect-ratio) on images.",
      noDims.slice(0, 3).map((i) => i.src).join(", ")));
  }
  const eagerCandidates = page.images.slice(3).filter((i) => i.loading !== "lazy");
  if (page.images.length > 6 && eagerCandidates.length >= 4) {
    push(mk(page, "IMG-LAZY", "performance", "low", "Below-the-fold images not lazy-loaded",
      `${eagerCandidates.length} images could use loading="lazy".`,
      "Lazy-loading offscreen images speeds up initial render.",
      "Add loading=\"lazy\" to images below the fold (never to the LCP image)."));
  }

  // --- Structured data ---
  const invalid = page.structuredData.filter((b) => !b.valid);
  if (invalid.length) {
    push(mk(page, "SD-INVALID", "structured-data", "medium", "Invalid JSON-LD",
      `${invalid.length} structured-data block(s) failed to parse.`,
      "Invalid markup is ignored by search engines and loses rich-result eligibility.",
      "Fix the JSON-LD syntax and validate with the Rich Results Test.",
      invalid[0]?.raw));
  } else if (page.indexable && page.structuredData.length === 0) {
    push(mk(page, "SD-MISSING", "structured-data", "info", "No structured data",
      "No JSON-LD structured data was found.",
      "Schema.org markup unlocks rich results (ratings, breadcrumbs, FAQs).",
      "Add relevant schema (Organization, WebSite, Breadcrumb, Product, etc.)."));
  }

  // --- Accessibility / mobile ---
  if (!page.lang) {
    push(mk(page, "A11Y-LANG", "accessibility", "medium", "Missing lang attribute",
      "The <html> element has no lang attribute.",
      "Screen readers use lang to select the correct voice/pronunciation.",
      "Add lang to <html>, e.g. <html lang=\"en\">."));
  }
  if (!page.metaViewport) {
    push(mk(page, "MOBILE-VIEWPORT", "accessibility", "medium", "Missing viewport meta tag",
      "No responsive viewport meta tag was found.",
      "Without it, mobile browsers render a zoomed-out desktop layout.",
      "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">."));
  }

  // --- Excessive links ---
  const totalLinks = page.internalLinkCount + page.externalLinkCount;
  if (totalLinks > 150) {
    push(mk(page, "LINK-EXCESSIVE", "links", "low", "Excessive links on page",
      `${totalLinks} links found on a single page.`,
      "Too many links dilute the value passed to each and can look spammy.",
      "Prune to the most useful links; keep primary navigation focused."));
  }

  // --- Security headers ---
  const h = page.headers;
  const isHttps = page.url.startsWith("https://");
  if (!isHttps) {
    push(mk(page, "SEC-HTTPS", "security", "high", "Page served over HTTP",
      "This URL was served without HTTPS.",
      "Unencrypted pages are insecure and penalized in ranking; browsers flag them.",
      "Serve all pages over HTTPS and redirect HTTP to HTTPS."));
  } else if (!h["strict-transport-security"]) {
    push(mk(page, "SEC-HSTS", "security", "medium", "Missing HSTS header",
      "No Strict-Transport-Security header.",
      "HSTS forces browsers to use HTTPS, protecting against downgrade attacks.",
      "Add Strict-Transport-Security with a long max-age."));
  }
  if (!h["x-content-type-options"]) {
    push(mk(page, "SEC-XCTO", "security", "low", "Missing X-Content-Type-Options",
      "No X-Content-Type-Options: nosniff header.",
      "Prevents MIME-sniffing attacks.",
      "Add X-Content-Type-Options: nosniff."));
  }
  if (!h["content-security-policy"]) {
    push(mk(page, "SEC-CSP", "security", "low", "Missing Content-Security-Policy",
      "No Content-Security-Policy header.",
      "CSP is a strong defense against XSS and injection.",
      "Add a Content-Security-Policy header suited to your assets."));
  }
}

function siteRules(ctx: Ctx, out: Finding[]) {
  const html = ctx.pages.filter((p) => p.ok && p.contentType.includes("html"));

  // Duplicate titles / descriptions / content across pages.
  groupDuplicates(html, (p) => (p.indexable && p.title ? p.title.toLowerCase() : null)).forEach((group) => {
    const [first, ...rest] = group;
    void rest;
    out.push(mk(first, "DUP-TITLE", "seo", "medium", "Duplicate title across pages",
      `${group.length} pages share the title "${first.title}".`,
      "Duplicate titles confuse search engines about which page to rank.",
      "Give each page a unique, descriptive title.",
      group.map((p) => p.url).slice(0, 5).join("\n")));
  });
  groupDuplicates(html, (p) => (p.indexable && p.metaDescription ? p.metaDescription.toLowerCase() : null)).forEach((group) => {
    const first = group[0];
    out.push(mk(first, "DUP-META", "seo", "low", "Duplicate meta description",
      `${group.length} pages share the same meta description.`,
      "Duplicate descriptions waste snippet real estate and signal low differentiation.",
      "Write a unique description for each page.",
      group.map((p) => p.url).slice(0, 5).join("\n")));
  });
  groupDuplicates(html, (p) => (p.indexable && p.wordCount > 50 ? p.contentHash : null)).forEach((group) => {
    const first = group[0];
    out.push(mk(first, "DUP-CONTENT", "content", "medium", "Duplicate content",
      `${group.length} indexable pages have identical body content.`,
      "Duplicate content splits ranking signals and can be filtered from results.",
      "Consolidate with canonicals or differentiate the content.",
      group.map((p) => p.url).slice(0, 5).join("\n")));
  });

  // Orphan pages: crawled (found via sitemap) but no internal inlinks.
  for (const p of html) {
    if (p.depth === 0) continue;
    const inbound = ctx.inlinks.get(p.url);
    if ((!inbound || inbound.size === 0) && p.indexable) {
      out.push(mk(p, "ORPHAN", "links", "medium", "Orphan page (no internal links)",
        "No internal links to this page were found among crawled pages.",
        "Orphan pages are hard for users and crawlers to discover and rarely rank.",
        "Link to this page from relevant navigation or related content."));
    }
  }

  // Broken links from the crawl sweep.
  for (const bl of ctx.crawl.brokenLinks) {
    const from = ctx.pages.find((p) => p.url === bl.from) || ctx.pages[0];
    const internal = registrableHost(safeHost(bl.to)) === registrableHost(safeHost(bl.from));
    out.push(mk(from, internal ? "LINK-BROKEN-INTERNAL" : "LINK-BROKEN-EXTERNAL", "links",
      internal ? "high" : "medium",
      internal ? "Broken internal link" : "Broken external link",
      `Link to ${bl.to} returned ${bl.status === 0 ? "a network error" : "HTTP " + bl.status}.`,
      "Broken links frustrate users and waste crawl budget.",
      internal ? "Fix or remove the link, or restore the target page." : "Update or remove the external link.",
      `${bl.anchor ? `"${bl.anchor}" → ` : ""}${bl.to}`));
  }

  // Site-wide crawl health.
  const entry = ctx.pages.find((p) => p.depth === 0);
  if (entry && !ctx.crawl.robotsFound) {
    out.push(mk(entry, "SITE-NO-ROBOTS", "indexability", "low", "No robots.txt found",
      "The site does not serve a robots.txt file.",
      "robots.txt controls crawler access and points to your sitemap.",
      "Add a robots.txt that references your XML sitemap."));
  }
  if (entry && !ctx.crawl.sitemapFound) {
    out.push(mk(entry, "SITE-NO-SITEMAP", "indexability", "low", "No XML sitemap discovered",
      "No sitemap was referenced in robots.txt.",
      "Sitemaps help search engines discover all your important pages.",
      "Generate an XML sitemap and reference it in robots.txt."));
  }
}

// ---- helpers ----

function buildInlinkMap(pages: PageEvidence[]): Map<string, Set<string>> {
  const known = new Set(pages.map((p) => p.url));
  const map = new Map<string, Set<string>>();
  for (const p of pages) {
    for (const l of p.links) {
      if (!l.internal) continue;
      if (!known.has(l.href)) continue;
      if (l.href === p.url) continue;
      if (!map.has(l.href)) map.set(l.href, new Set());
      map.get(l.href)!.add(p.url);
    }
  }
  return map;
}

function groupDuplicates(
  pages: PageEvidence[],
  keyFn: (p: PageEvidence) => string | null,
): PageEvidence[][] {
  const groups = new Map<string, PageEvidence[]>();
  for (const p of pages) {
    const key = keyFn(p);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

function stripSlash(u: string): string {
  return u.replace(/\/+$/, "");
}

function safeHost(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}
