import { load } from "cheerio";
import { buildEvidence, cssUrls, assetUrl } from "../extract";
import { isHtmlPath, sameOrigin } from "../normalize";
import { parseRobots, isAllowedByRobots } from "../robots";
import { runPageSpeed } from "../pagespeed";
import { database } from "../database";
import { crawlUrl } from "./config";
import { fetchEvidence } from "./http";
import { recordKey } from "./store";
import { renderPage } from "./browser";
import { analyzeImage, imageFindings, type ImageAnalysis } from "./images";
import type { PageImage } from "../types";
import type { AuditJob, CrawlTask, EvidenceRecord, TaskInput, TaskOutput } from "./types";

export const evidenceRecord = (kind: string, url: string, data: unknown, source?: string, identity = url): EvidenceRecord => ({ kind, key: recordKey(kind, identity), url, source_url: source, data });
export function findingRecords(findings: import("../types").Finding[]): EvidenceRecord[] {
  return findings.map(f => ({ kind: "findings", key: recordKey(f.ruleId, f.url, f.element || "", f.evidence || ""), url: f.url, title: f.title, category: f.category, severity: f.severity, status: "open", data: { ...f, status: "open", priority: ({ critical: 100, high: 80, medium: 50, low: 20, info: 5 })[f.severity] } }));
}
export async function processTask(job: AuditJob, task: CrawlTask): Promise<TaskOutput> {
  const config = job.config; const records: EvidenceRecord[] = []; const tasks: TaskInput[] = [];
  if (task.kind === "robots") {
    const url = new URL("/robots.txt", job.url).href;
    let robots = { found: false, sitemaps: [] as string[], disallow: [] as string[], allow: [] as string[], crawlDelay: null as number | null };
    try {
      const response = await fetchEvidence(url, config);
      robots = response.status === 200 ? parseRobots(response.bytes.toString("utf8")) : { ...robots, disallow: [401,403].includes(response.status) ? ["/"] : [] };
      records.push(evidenceRecord("policy", url, { ...robots, status: response.status, limitation: response.status !== 200 ? `Robots policy returned HTTP ${response.status}. Access restrictions are retained.` : null }));
    } catch { records.push(evidenceRecord("policy", url, { limitation: "Robots policy could not be retrieved. Public-page requests continue within configured limits; blocked responses are not bypassed." })); }
    tasks.push({ kind: "page", url: job.url, depth: 0, priority: 5 });
    for (const sitemap of new Set([...robots.sitemaps, new URL("/sitemap.xml", job.url).href, new URL("/sitemap_index.xml", job.url).href])) tasks.push({ kind: "sitemap", url: sitemap, priority: 1 });
    return { records, tasks, metadata: { robots } };
  }
  if (task.kind === "sitemap") {
    const response = await fetchEvidence(task.url, config);
    if (response.status >= 500 || response.status === 429) throw new Error(`Sitemap HTTP ${response.status}`);
    const $ = load(response.bytes.toString("utf8"), { xml: true });
    const index = $("sitemapindex").length > 0;
    records.push(evidenceRecord("sitemaps", task.url, { status: response.status, index, truncated: response.truncated, entries: $("loc").length }));
    if (response.status === 200) $("loc").each((_, el) => {
      const raw = $(el).text().trim(); const url = crawlUrl(raw, task.url, config); if (!url) return;
      if (index) tasks.push({ kind: "sitemap", url, priority: 1 });
      else if (sameOrigin(url, job.url)) {
        tasks.push({ kind: "page", url, depth: 0, source_url: task.url, priority: 5 });
        records.push(evidenceRecord("sitemap_urls", url, { url, sitemap: task.url, lastmod: $(el).parent().find("lastmod").text() || null }, task.url, `${task.url}|${url}`));
      }
    });
  } else if (task.kind === "page") {
    const u = new URL(task.url);
    if (job.robots && !isAllowedByRobots(u.pathname + u.search, job.robots)) return { records: [evidenceRecord("restrictions", task.url, { reason: "Blocked by robots.txt", source: task.source_url })], tasks: [] };
    const response = await fetchEvidence(task.url, config);
    if (response.status >= 500 || response.status === 429) throw new Error(`Page HTTP ${response.status}`);
    let page = buildEvidence({ requestedUrl: task.url, finalUrl: response.url, depth: task.depth, status: response.status, ok: response.status >= 200 && response.status < 400, redirected: response.redirects.length > 0, redirectChain: response.redirects, contentType: response.headers["content-type"] || "", contentLengthBytes: response.bytes.length, responseTimeMs: response.durationMs, headers: response.headers, body: response.bytes.toString("utf8") });
    if (response.truncated) page.limitations?.push("HTML reached the configured byte limit; extraction is partial.");
    if (page.ok && /html/.test(page.contentType) && (config.rendering === "browser" || (config.rendering === "adaptive" && page.wordCount < config.minWords && /<script\b/i.test(response.bytes.toString("utf8"))))) {
      try { page = await renderPage(response, task.url, task.depth, config); }
      catch (error) { page.limitations?.push(`Browser rendering unavailable: ${error instanceof Error ? error.message.slice(0,200) : "render failed"}. HTTP evidence is retained.`); }
    }
    records.push({ ...evidenceRecord("pages", task.url, page), title: page.title || task.url, status: String(page.status) });
    for (const block of page.structuredData) records.push(evidenceRecord("structured_data", page.url, block, page.url, `${page.url}|${JSON.stringify(block)}`));
    for (const link of page.links) {
      records.push({ ...evidenceRecord("links", link.href, link, page.url, `${page.url}|${link.href}|${link.anchor}|${link.rel}|${link.selector}`), title: link.anchor });
      if (config.checkExternalLinks || link.internal) tasks.push({ kind: "link", url: link.href, source_url: page.url, priority: 15 });
    }
    if (task.depth < config.maxDepth && page.ok && sameOrigin(page.url, job.url)) {
      const discovered = [...page.links.filter(l => l.internal && !l.nofollow).map(l => l.href), page.canonical, ...page.hreflang.map(l=>l.href), ...(page.pagination || [])];
      const visitSchema = (node: unknown, depth=0) => { if (!node || typeof node !== "object" || depth>20) return; if(Array.isArray(node)){node.forEach(n=>visitSchema(n,depth+1));return;} for(const [key,value] of Object.entries(node)){if(["url","@id"].includes(key) && typeof value === "string")discovered.push(value);else visitSchema(value,depth+1);} };
      page.structuredData.forEach(block=>visitSchema(block.data));
      for (const raw of discovered) {
        if (!raw) continue; const url = crawlUrl(raw, page.url, config);
        if (url && sameOrigin(url, job.url) && isHtmlPath(url)) tasks.push({ kind: "page", url, depth: task.depth + 1, source_url: page.url, priority: 5 });
      }
    }
    if (config.images) for (const image of page.images) {
      records.push(evidenceRecord("image_usage", image.src, image, page.url, `${page.url}|${image.src}|${image.selector}|${image.source}`));
      tasks.push({ kind: "image", url: image.src, source_url: page.url, priority: 10 });
    }
    if (config.resources) for (const resource of page.resources || []) {
      records.push(evidenceRecord("resource_usage", resource.url, resource, page.url, `${page.url}|${resource.url}`));
      if (/^https?:/.test(resource.url)) tasks.push({ kind: "resource", url: resource.url, source_url: page.url, payload: { type: resource.type }, priority: 15 });
    }
    if (config.performance && page.ok) tasks.push({ kind: "performance", url: page.url, priority: 20 });
    if (config.ai && page.ok) tasks.push({ kind: "ai_page", url: task.url, priority: 30 });
  } else if (task.kind === "image") {
    const result = await analyzeImage(task.url, config);
    records.push({ ...evidenceRecord("images", task.url, result), title: result.filename, status: result.error ? "error" : "measured" });
    // Images can be discovered after an asset probe; final analysis revisits all usages.
    if (config.ai && !result.error && /^image\//.test(result.mime)) tasks.push({ kind: "ai_image", url: task.url, priority: 30 });
  } else if (task.kind === "link" || task.kind === "resource") {
    const isCss = task.payload.type === "stylesheet";
    let response = await fetchEvidence(task.url, config, { method: isCss ? "GET" : "HEAD" });
    if ([405,501].includes(response.status)) response = await fetchEvidence(task.url, config, { maxBytes: 10000 });
    if (response.status >= 500 || response.status === 429) throw new Error(`Resource HTTP ${response.status}`);
    const data = { url: task.url, finalUrl: response.url, status: response.status, redirects: response.redirects, responseTimeMs: response.durationMs, contentType: response.headers["content-type"], bytes: Number(response.headers["content-length"]) || null, cacheControl: response.headers["cache-control"] || null, contentEncoding: response.headers["content-encoding"] || null, type: task.payload.type, limitation: "Header-provided size is not a measured browser transfer. Missing fields were not reported by the server." };
    records.push(evidenceRecord(task.kind === "link" ? "link_targets" : "resources", task.url, data));
    if (isCss && config.images) for (const raw of cssUrls(response.bytes.toString("utf8"))) {
      const url = assetUrl(raw, response.url); if (!url) continue;
      if (/\.(woff2?|ttf|otf)(\?|$)/i.test(url)) tasks.push({kind:"resource",url,source_url:task.url,payload:{type:"font"},priority:15});
      else { tasks.push({kind:"image",url,source_url:task.source_url || task.url,priority:10}); records.push(evidenceRecord("image_usage", url, {src:url,alt:null,width:null,height:null,loading:null,source:"stylesheet",context:`Background asset from ${task.url}`},task.source_url || task.url, `${task.source_url}|${task.url}|${url}`)); }
    }
  } else if (task.kind === "performance") {
    const results = await Promise.all([runPageSpeed(task.url,"mobile"), runPageSpeed(task.url,"desktop")]);
    records.push(...results.map(result=>evidenceRecord("performance",task.url,result,undefined,`${task.url}|${result.strategy}`)));
  } else if (task.kind.startsWith("ai_")) {
    const { analyzeTask } = await import("./ai");
    records.push(await analyzeTask(job, task));
  }
  return { records, tasks };
}

export async function collectImageFindings(job: AuditJob, usage: EvidenceRecord<PageImage>[]) {
  const urls = [...new Set(usage.map(u=>u.url))];
  const assets = await database<EvidenceRecord<ImageAnalysis>[]>(`audit_records?job_id=eq.${job.id}&kind=eq.images&key=in.(${urls.map(url=>recordKey("images",url)).join(",")})`);
  const byUrl = new Map(assets.map(a=>[a.url,a.data]));
  return findingRecords(usage.flatMap(u=>{const asset=byUrl.get(u.url);return asset ? imageFindings(u.source_url || job.url,u.data,asset,job.config) : [];}));
}
