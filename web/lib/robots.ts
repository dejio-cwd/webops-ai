// Minimal robots.txt parser + sitemap discovery. We respect Disallow rules
// for our own user-agent (falling back to the "*" group) so the crawler
// behaves like a good citizen.

export interface RobotsGroupRules {
  disallow: string[];
  allow: string[];
  crawlDelay: number | null;
}

export interface RobotsInfo extends RobotsGroupRules {
  found: boolean;
  sitemaps: string[];
}

const OUR_AGENT = "webopsai";

export function parseRobots(text: string): RobotsInfo {
  const sitemaps: string[] = [];
  const groups = new Map<string, RobotsGroupRules>();
  let currentAgents: string[] = [];
  let expectingAgent = false;

  const ensure = (agent: string): RobotsGroupRules => {
    let g = groups.get(agent);
    if (!g) {
      g = { disallow: [], allow: [], crawlDelay: null };
      groups.set(agent, g);
    }
    return g;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === "user-agent") {
      if (!expectingAgent) currentAgents = [];
      currentAgents.push(value.toLowerCase());
      expectingAgent = true;
      continue;
    }
    expectingAgent = false;
    if (!currentAgents.length) continue;
    for (const agent of currentAgents) {
      const g = ensure(agent);
      if (field === "disallow" && value) g.disallow.push(value);
      else if (field === "allow" && value) g.allow.push(value);
      else if (field === "crawl-delay") {
        const n = Number(value);
        if (!Number.isNaN(n)) g.crawlDelay = n;
      }
    }
  }

  // Prefer a group that names us; otherwise the wildcard group.
  const chosen =
    [...groups.keys()].find((a) => a.includes(OUR_AGENT)) ??
    (groups.has("*") ? "*" : undefined);
  const rules = chosen ? groups.get(chosen)! : { disallow: [], allow: [], crawlDelay: null };
  return { found: true, sitemaps, ...rules };
}

/** Path-prefix match, honoring the more-specific Allow-over-Disallow rule. */
export function isAllowedByRobots(pathname: string, info: RobotsInfo): boolean {
  if (!info.found) return true;
  const match = (rule: string) => pathname.startsWith(rule.replace(/\*+$/, ""));
  const disallowed = info.disallow
    .filter(match)
    .sort((a, b) => b.length - a.length)[0];
  if (!disallowed) return true;
  const allowed = info.allow.filter(match).sort((a, b) => b.length - a.length)[0];
  return Boolean(allowed && allowed.length >= disallowed.length);
}

/** Fetch arbitrary text (robots.txt, sitemaps) with an SSRF-safe request. */
export async function fetchText(url: string, timeoutMs = 8000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { validateTarget } = await import("./ssrf");
    const target = await validateTarget(url);
    const res = await fetch(target, {
      signal: controller.signal,
      headers: { "User-Agent": "WebOpsAI/1.0 (+website audit bot)" },
    });
    if (!res.ok) return "";
    const text = await res.text();
    return text.slice(0, 3_000_000);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchRobots(origin: string): Promise<RobotsInfo> {
  const raw = await fetchText(new URL("/robots.txt", origin).href);
  if (!raw) {
    return { found: false, sitemaps: [], disallow: [], allow: [], crawlDelay: null };
  }
  return parseRobots(raw);
}

/** Extract <loc> URLs from a sitemap or sitemap index (recurses one level). */
export async function discoverSitemapUrls(
  sitemapUrls: string[],
  limit: number,
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [...sitemapUrls];
  let processed = 0;
  while (queue.length && out.length < limit && processed < 12) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    processed++;
    const xml = await fetchText(sm);
    if (!xml) continue;
    const isIndex = /<sitemapindex/i.test(xml);
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) =>
      m[1].trim(),
    );
    if (isIndex) {
      for (const loc of locs.slice(0, 6)) queue.push(loc);
    } else {
      for (const loc of locs) {
        out.push(loc);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}
