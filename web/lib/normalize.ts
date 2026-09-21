// URL normalization + classification helpers used by the crawler and rules.

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "ref",
  "ref_src",
]);

/**
 * Normalize a URL for de-duplication:
 *  - lowercase scheme + host
 *  - drop default ports
 *  - drop fragments
 *  - strip known tracking params
 *  - sort remaining query params
 *  - collapse trailing slash (except root)
 * The fragment and tracking params never change page content, so removing
 * them prevents crawling the same page many times.
 */
export function normalizeUrl(input: string, base?: string): string | null {
  let u: URL;
  try {
    u = base ? new URL(input, base) : new URL(input);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(u.protocol)) return null;
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  if (
    (u.protocol === "http:" && u.port === "80") ||
    (u.protocol === "https:" && u.port === "443")
  ) {
    u.port = "";
  }
  const params = new URLSearchParams();
  const keys = [...u.searchParams.keys()].sort();
  for (const key of keys) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) continue;
    for (const value of u.searchParams.getAll(key)) params.append(key, value);
  }
  u.search = params.toString() ? `?${params.toString()}` : "";
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }
  return u.toString();
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return registrableHost(ua.hostname) === registrableHost(ub.hostname);
  } catch {
    return false;
  }
}

/** Treat www and apex as the same registrable host for crawl scoping. */
export function registrableHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

export function isHtmlPath(url: string): boolean {
  try {
    const p = new URL(url).pathname.toLowerCase();
    return !/\.(png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|json|xml|pdf|zip|gz|mp4|mp3|webm|woff2?|ttf|eot|txt|csv|rss)$/.test(
      p,
    );
  } catch {
    return false;
  }
}
