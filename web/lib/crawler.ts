// Breadth-first, same-site crawler tuned for serverless execution.
// It is deadline-aware (stops before the function times out), respects
// robots.txt, seeds from the sitemap, de-duplicates via URL normalization,
// and runs a bounded broken-link sweep at the end.

import { validateTarget } from "./ssrf";
import { safeFetch } from "./fetcher";
import { buildEvidence } from "./extract";
import { registrableHost, normalizeUrl, isHtmlPath, sameOrigin } from "./normalize";
import {
  fetchRobots,
  discoverSitemapUrls,
  isAllowedByRobots,
  type RobotsInfo,
} from "./robots";
import type { PageEvidence, CrawlStats, BrokenLink } from "./types";

export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  respectRobots?: boolean;
  checkExternalLinks?: boolean;
  deadlineMs?: number;
  concurrency?: number;
}

export interface CrawlOutput {
  stats: CrawlStats;
  pages: PageEvidence[];
  robots: RobotsInfo;
}

// Absolute safety ceiling — protects against a single invocation running away.
// The real, practical limit is the serverless function deadline (deadlineMs):
// a crawl always stops early and reports `truncated: true` rather than time out.
// Configurable per-request up to this ceiling via the "Crawl settings" panel.
export const HARD_MAX_PAGES = 2000;
export const HARD_MAX_CONCURRENCY = 16;
export const HARD_MAX_DEPTH = 12;

export async function crawlSite(
  requestedUrl: string,
  options: CrawlOptions = {},
): Promise<CrawlOutput> {
  const startedAt = Date.now();
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 20, HARD_MAX_PAGES));
  const maxDepth = Math.max(0, Math.min(options.maxDepth ?? 3, HARD_MAX_DEPTH));
  const respectRobots = options.respectRobots ?? true;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 6, HARD_MAX_CONCURRENCY));
  const deadline = startedAt + (options.deadlineMs ?? 45000);

  const entry = await validateTarget(requestedUrl); // throws if unsafe/invalid
  const origin = entry.origin;
  const host = registrableHost(entry.hostname);

  const robots = respectRobots
    ? await fetchRobots(origin)
    : { found: false, sitemaps: [], disallow: [], allow: [], crawlDelay: null };

  // Seed the frontier: entry URL first, then sitemap URLs (same host only).
  const startUrl = normalizeUrl(entry.href) || entry.href;
  const seen = new Set<string>([startUrl]);
  const frontier: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }];

  let fromSitemap = 0;
  if (robots.sitemaps.length) {
    const sitemapUrls = await discoverSitemapUrls(robots.sitemaps, maxPages * 2);
    for (const raw of sitemapUrls) {
      const n = normalizeUrl(raw);
      if (!n || !sameOrigin(n, startUrl) || seen.has(n)) continue;
      if (!isHtmlPath(n)) continue;
      seen.add(n);
      frontier.push({ url: n, depth: 1 });
      fromSitemap++;
    }
  }

  const pages: PageEvidence[] = [];
  const statusCounts: Record<string, number> = {};
  const knownStatus = new Map<string, number>(); // url -> status (for link checking)
  let requested = 0;

  const crawlOne = async (item: { url: string; depth: number }) => {
    if (pages.length >= maxPages || Date.now() > deadline) return;
    if (respectRobots && robots.found) {
      const path = new URL(item.url).pathname;
      if (!isAllowedByRobots(path, robots)) return;
    }
    requested++;
    try {
      const res = await safeFetch(item.url, { timeoutMs: 10000 });
      knownStatus.set(item.url, res.status);
      if (res.finalUrl !== item.url) knownStatus.set(res.finalUrl, res.status);
      const bucket = `${Math.floor(res.status / 100)}xx`;
      statusCounts[bucket] = (statusCounts[bucket] || 0) + 1;
      const evidence = buildEvidence({
        requestedUrl: item.url,
        finalUrl: res.finalUrl,
        depth: item.depth,
        status: res.status,
        ok: res.ok,
        redirected: res.redirected,
        redirectChain: res.redirectChain,
        contentType: res.contentType,
        contentLengthBytes: res.contentLengthBytes,
        responseTimeMs: res.responseTimeMs,
        headers: res.headers,
        body: res.body,
      });
      pages.push(evidence);

      // Enqueue new internal links.
      if (item.depth < maxDepth && res.body) {
        for (const link of evidence.links) {
          if (!link.internal || link.nofollow) continue;
          if (registrableHost(new URL(link.href).hostname) !== host) continue;
          if (!isHtmlPath(link.href) || seen.has(link.href)) continue;
          if (seen.size >= maxPages * 4) break;
          seen.add(link.href);
          frontier.push({ url: link.href, depth: item.depth + 1 });
        }
      }
    } catch (err) {
      statusCounts["error"] = (statusCounts["error"] || 0) + 1;
      pages.push(errorPage(item.url, item.depth, err));
    }
  };

  // Deadline + page-cap aware worker pool over a growing frontier.
  let cursor = 0;
  while (cursor < frontier.length && pages.length < maxPages && Date.now() < deadline) {
    const batch = frontier.slice(cursor, cursor + Math.min(concurrency, maxPages - pages.length));
    cursor += batch.length;
    await Promise.all(batch.map(crawlOne));
    if (robots.crawlDelay && robots.crawlDelay > 0) {
      await sleep(Math.min(robots.crawlDelay * 1000, 2000));
    }
  }

  const truncated = frontier.length > cursor || seen.size > pages.length;

  // Bounded broken-link sweep: sample links we haven't already resolved.
  const brokenLinks = await checkBrokenLinks(
    pages,
    knownStatus,
    options.checkExternalLinks ?? true,
    deadline,
  );

  const finishedAt = Date.now();
  const stats: CrawlStats = {
    requestedUrl,
    origin,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - startedAt,
    pagesCrawled: pages.length,
    pagesRequested: requested,
    maxPages,
    maxDepth,
    fromSitemap,
    robotsFound: robots.found,
    sitemapFound: robots.sitemaps.length > 0,
    statusCounts,
    brokenLinks,
    truncated,
  };
  return { stats, pages, robots };
}

async function checkBrokenLinks(
  pages: PageEvidence[],
  knownStatus: Map<string, number>,
  includeExternal: boolean,
  deadline: number,
): Promise<BrokenLink[]> {
  const broken: BrokenLink[] = [];
  const toCheck = new Map<string, { from: string; anchor: string }>();

  // Record broken links we already know about from the crawl itself.
  for (const page of pages) {
    for (const link of page.links) {
      const known = knownStatus.get(link.href);
      if (known !== undefined && known >= 400) {
        broken.push({ from: page.url, to: link.href, status: known, anchor: link.anchor });
        continue;
      }
      if (known !== undefined) continue;
      if (!includeExternal && !link.internal) continue;
      if (!toCheck.has(link.href)) toCheck.set(link.href, { from: page.url, anchor: link.anchor });
    }
  }

  const budget = 25;
  const targets = [...toCheck.entries()].slice(0, budget);
  const concurrency = 6;
  for (let i = 0; i < targets.length && Date.now() < deadline; i += concurrency) {
    const slice = targets.slice(i, i + concurrency);
    await Promise.all(
      slice.map(async ([url, meta]) => {
        try {
          let res = await safeFetch(url, { method: "HEAD", timeoutMs: 7000, wantBody: false });
          // Some servers reject HEAD; retry with GET on 405/501.
          if (res.status === 405 || res.status === 501) {
            res = await safeFetch(url, { method: "GET", timeoutMs: 8000, wantBody: false });
          }
          if (res.status >= 400) {
            broken.push({ from: meta.from, to: url, status: res.status, anchor: meta.anchor });
          }
        } catch {
          broken.push({ from: meta.from, to: url, status: 0, anchor: meta.anchor });
        }
      }),
    );
  }
  return broken;
}

function errorPage(url: string, depth: number, err: unknown): PageEvidence {
  const message = err instanceof Error ? err.message : "Request failed";
  return {
    url,
    finalUrl: url,
    requestedUrl: url,
    depth,
    status: 0,
    ok: false,
    redirected: false,
    redirectChain: [],
    contentType: "",
    contentLengthBytes: 0,
    responseTimeMs: 0,
    headers: {},
    title: null,
    titleLength: 0,
    metaDescription: null,
    metaDescriptionLength: 0,
    canonical: null,
    robotsMeta: null,
    xRobotsTag: null,
    metaViewport: null,
    lang: null,
    charset: null,
    h1: [],
    h2Count: 0,
    headingOutlineIssues: [],
    openGraph: {},
    twitter: {},
    hreflang: [],
    structuredData: [],
    wordCount: 0,
    textToHtmlRatio: 0,
    contentHash: "",
    links: [],
    internalLinkCount: 0,
    externalLinkCount: 0,
    images: [],
    indexable: false,
    indexabilityReason: message,
    findings: [],
    error: message,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
