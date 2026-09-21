// Dependency-free HTML evidence extraction. We deliberately avoid a heavyweight
// DOM parser: this runs in serverless functions and must stay fast and small.
// The regexes are tuned for real-world markup and are resilient to attribute
// ordering and quote style.

import crypto from "node:crypto";
import type {
  PageEvidence,
  PageImage,
  PageLink,
  StructuredDataBlock,
} from "./types";
import { normalizeUrl, sameOrigin } from "./normalize";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
  "#x27": "'",
  "#x2F": "/",
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code) => {
      if (ENTITIES[code]) return ENTITIES[code];
      if (code[0] === "#") {
        const num =
          code[1] === "x" || code[1] === "X"
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        if (!Number.isNaN(num)) return String.fromCodePoint(num);
      }
      return m;
    })
    .trim();
}

function clean(text: string | null | undefined): string | null {
  if (!text) return null;
  const out = decodeEntities(text.replace(/<[^>]+>/g, "").replace(/\s+/g, " "));
  return out || null;
}

/** Parse an HTML tag's attributes into a lowercase-keyed map. */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  // Skip the tag name itself.
  const body = tag.replace(/^<\s*[a-zA-Z0-9]+/, "");
  while ((m = re.exec(body))) {
    const key = m[1].toLowerCase();
    const val = m[3] ?? m[4] ?? m[5] ?? "";
    out[key] = decodeEntities(val);
  }
  return out;
}

function firstTag(html: string, tagName: string): Record<string, string> | null {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, "i");
  const m = html.match(re);
  return m ? attrs(m[0]) : null;
}

function allTags(html: string, tagName: string): Record<string, string>[] {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  return [...html.matchAll(re)].map((m) => attrs(m[0]));
}

function extractMetas(html: string): Record<string, string>[] {
  return allTags(html, "meta");
}

function textContent(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractStructuredData(html: string): StructuredDataBlock[] {
  const blocks: StructuredDataBlock[] = [];
  const re =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1].trim();
    try {
      const parsed = JSON.parse(raw);
      const types = new Set<string>();
      const walk = (node: unknown) => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (node && typeof node === "object") {
          const obj = node as Record<string, unknown>;
          const t = obj["@type"];
          if (typeof t === "string") types.add(t);
          else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.add(x));
          if (Array.isArray(obj["@graph"])) (obj["@graph"] as unknown[]).forEach(walk);
        }
      };
      walk(parsed);
      blocks.push({ types: [...types], valid: true });
    } catch {
      blocks.push({ types: [], valid: false, raw: raw.slice(0, 200) });
    }
  }
  return blocks;
}

function extractLinks(html: string, baseUrl: string): PageLink[] {
  const links: PageLink[] = [];
  const seen = new Set<string>();
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const a = attrs("<a " + m[1] + ">");
    const raw = a.href;
    if (!raw || raw.startsWith("#") || /^(javascript|mailto|tel):/i.test(raw)) continue;
    const href = normalizeUrl(raw, baseUrl);
    if (!href) continue;
    const rel = a.rel ? a.rel.toLowerCase() : null;
    const key = href + "|" + (rel || "");
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      href,
      raw,
      anchor: clean(m[2]) || "",
      rel,
      internal: sameOrigin(href, baseUrl),
      nofollow: rel ? rel.split(/\s+/).includes("nofollow") : false,
    });
  }
  return links;
}

function extractImages(html: string, baseUrl: string): PageImage[] {
  const images: PageImage[] = [];
  for (const img of allTags(html, "img")) {
    const rawSrc = img.src || img["data-src"] || "";
    if (!rawSrc) continue;
    const src = normalizeUrl(rawSrc, baseUrl) || rawSrc;
    images.push({
      src,
      alt: img.alt !== undefined ? decodeEntities(img.alt) : null,
      width: img.width || null,
      height: img.height || null,
      loading: img.loading ? img.loading.toLowerCase() : null,
    });
  }
  return images;
}

export interface ExtractInput {
  requestedUrl: string;
  finalUrl: string;
  depth: number;
  status: number;
  ok: boolean;
  redirected: boolean;
  redirectChain: { url: string; status: number }[];
  contentType: string;
  contentLengthBytes: number;
  responseTimeMs: number;
  headers: Record<string, string>;
  body: string;
}

export function buildEvidence(input: ExtractInput): PageEvidence {
  const html = input.body;
  const base = input.finalUrl;

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = clean(titleMatch?.[1]);

  const metas = extractMetas(html);
  const metaByName = (name: string) =>
    metas.find((m) => (m.name || "").toLowerCase() === name.toLowerCase());
  const metaByProp = (prop: string) =>
    metas.find((m) => (m.property || "").toLowerCase() === prop.toLowerCase());

  const description = clean(metaByName("description")?.content);
  const robotsMeta = metaByName("robots")?.content?.toLowerCase() || null;
  const viewport = metaByName("viewport")?.content || null;
  const charsetMeta =
    metas.find((m) => m.charset)?.charset ||
    metaByName("charset")?.content ||
    (input.headers["content-type"]?.match(/charset=([^;]+)/i)?.[1] ?? null);

  const htmlTag = firstTag(html, "html");
  const lang = htmlTag?.lang || null;

  const canonicalLink = allTags(html, "link").find(
    (l) => (l.rel || "").toLowerCase() === "canonical",
  );
  const canonical = canonicalLink?.href ? normalizeUrl(canonicalLink.href, base) : null;

  const hreflang = allTags(html, "link")
    .filter((l) => (l.rel || "").toLowerCase() === "alternate" && l.hreflang)
    .map((l) => ({ lang: l.hreflang, href: normalizeUrl(l.href || "", base) || l.href || "" }));

  const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map((m) => clean(m[1]))
    .filter((x): x is string => Boolean(x));
  const h2Count = (html.match(/<h2\b[^>]*>/gi) || []).length;

  // Heading outline: detect skipped levels (e.g. h2 -> h4).
  const headingSeq = [...html.matchAll(/<h([1-6])\b[^>]*>/gi)].map((m) => Number(m[1]));
  const headingOutlineIssues: string[] = [];
  for (let i = 1; i < headingSeq.length; i++) {
    if (headingSeq[i] - headingSeq[i - 1] > 1) {
      headingOutlineIssues.push(`h${headingSeq[i - 1]} → h${headingSeq[i]} skips a level`);
    }
  }

  const openGraph: Record<string, string> = {};
  const twitter: Record<string, string> = {};
  for (const m of metas) {
    const prop = (m.property || "").toLowerCase();
    const name = (m.name || "").toLowerCase();
    if (prop.startsWith("og:")) openGraph[prop.slice(3)] = m.content || "";
    if (name.startsWith("twitter:")) twitter[name.slice(8)] = m.content || "";
  }
  void metaByProp;

  const text = textContent(html);
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const textToHtmlRatio = html.length ? Number((text.length / html.length).toFixed(3)) : 0;
  const contentHash = crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);

  const links = extractLinks(html, base);
  const images = extractImages(html, base);

  const xRobotsTag = input.headers["x-robots-tag"]?.toLowerCase() || null;
  const noindex =
    (robotsMeta?.includes("noindex") ?? false) ||
    (xRobotsTag?.includes("noindex") ?? false);
  const indexable = input.ok && input.status < 400 && !noindex;
  const indexabilityReason = !input.ok
    ? `HTTP ${input.status}`
    : noindex
      ? "noindex directive"
      : null;

  return {
    url: input.finalUrl,
    finalUrl: input.finalUrl,
    requestedUrl: input.requestedUrl,
    depth: input.depth,
    status: input.status,
    ok: input.ok,
    redirected: input.redirected,
    redirectChain: input.redirectChain,
    contentType: input.contentType,
    contentLengthBytes: input.contentLengthBytes,
    responseTimeMs: input.responseTimeMs,
    headers: input.headers,
    title,
    titleLength: title?.length ?? 0,
    metaDescription: description,
    metaDescriptionLength: description?.length ?? 0,
    canonical,
    robotsMeta,
    xRobotsTag,
    metaViewport: viewport,
    lang,
    charset: charsetMeta,
    h1,
    h2Count,
    headingOutlineIssues,
    openGraph,
    twitter,
    hreflang,
    structuredData: extractStructuredData(html),
    wordCount,
    textToHtmlRatio,
    contentHash,
    links,
    internalLinkCount: links.filter((l) => l.internal).length,
    externalLinkCount: links.filter((l) => !l.internal).length,
    images,
    indexable,
    indexabilityReason,
    findings: [],
  };
}
