import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { Element } from "domhandler";
import type { PageEvidence, PageImage, PageLink, PageResource, StructuredDataBlock } from "./types";
import { sameOrigin } from "./normalize";

export function decodeEntities(text: string): string { return load(`<span>${text}</span>`)("span").text().trim(); }
export function assetUrl(raw: string | undefined, base: string): string | null {
  if (!raw) return null;
  try { const url = new URL(raw, base); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function srcsetUrls(value: string): string[] {
  return value.split(/,\s*(?![^()]*\))/).map(item => item.trim().split(/\s+/)[0]).filter(Boolean);
}
export function cssUrls(value: string): string[] {
  return [...value.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map(m => m[1].trim());
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
  const $ = load(input.body); const base = assetUrl($("base[href]").first().attr("href"), input.finalUrl) || input.finalUrl;
  const selector = (element: Element): string => {
    const parts: string[] = []; let node: Element | null = element;
    while (node) {
      const tag = node.tagName;
      parts.unshift(`${tag}:nth-of-type(${$(node).prevAll(tag).length + 1})`);
      node = $(node).parent().get(0) as Element | undefined || null;
    }
    return parts.join(" > ");
  };
  const clean = (text: string) => text.replace(/\s+/g, " ").trim();
  const meta = (name: string) => $("meta").filter((_, el) => ($(el).attr("name") || $(el).attr("property") || "").toLowerCase() === name).first().attr("content") || null;
  const title = clean($("title").first().text()) || null;
  const description = meta("description");
  const headings = $("h1,h2,h3,h4,h5,h6").toArray().map((el) => ({ level: Number(el.tagName.slice(1)), text: clean($(el).text()), selector: selector(el) }));
  const headingOutlineIssues = headings.flatMap((h, i) => i && h.level > headings[i - 1].level + 1 ? [`h${headings[i-1].level} → h${h.level} skips a level`] : []);
  const links: PageLink[] = [];
  $("a[href],area[href]").each((_, el) => {
    const raw = $(el).attr("href") || ""; const href = assetUrl(raw, base); if (!href || raw.startsWith("#")) return;
    const rel = $(el).attr("rel")?.toLowerCase() || null;
    links.push({href, raw, anchor: clean($(el).text()) || $(el).find("img").attr("alt") || "", rel, internal: sameOrigin(href, base), nofollow: !!rel?.split(/\s+/).includes("nofollow"), imageOnly: !clean($(el).text()) && $(el).find("img").length > 0, selector: selector(el)});
  });
  const images: PageImage[] = []; const seen = new Set<string>();
  const addImage = (raw: string | undefined, details: Omit<PageImage, "src">) => {
    const src = assetUrl(raw, base); if (!src) return;
    const key = `${src}|${details.selector}|${details.source}`; if (seen.has(key)) return; seen.add(key);
    images.push({ src, ...details });
  };
  $("img").each((_, el) => {
    const img = $(el), srcset = img.attr("srcset") || img.attr("data-srcset") || "";
    const details = { alt: img.attr("alt") ?? null, width: img.attr("width") || null, height: img.attr("height") || null, loading: img.attr("loading") || null, title: img.attr("title") || null, decoding: img.attr("decoding"), fetchpriority: img.attr("fetchpriority"), srcset, sizes: img.attr("sizes"), selector: selector(el), context: clean(img.parent().text()).slice(0, 1000), caption: clean(img.closest("figure").find("figcaption").text()) };
    for (const name of ["src", "data-src", "data-original", "data-lazy-src", "data-url"]) addImage(img.attr(name), { ...details, source: name === "src" ? "img" : "lazy" });
    for (const candidate of srcsetUrls(srcset)) addImage(candidate, { ...details, source: "srcset" });
    img.closest("picture").find("source").each((_, source) => { for (const candidate of srcsetUrls($(source).attr("srcset") || $(source).attr("data-srcset") || "")) addImage(candidate, {...details, sizes: $(source).attr("sizes") || details.sizes, source: "picture"}); });
  });
  $("[style],style").each((_, el) => { for (const raw of cssUrls($(el).attr("style") || $(el).text())) addImage(raw, {alt:null,width:null,height:null,loading:null,source:"css",selector:selector(el), context:clean($(el).text()).slice(0,500)}); });
  for (const name of ["og:image", "og:image:url", "twitter:image"]) addImage(meta(name) || undefined, {alt:null,width:null,height:null,loading:null,source:name});
  $("link[rel='preload'][as='image']").each((_, el) => { addImage($(el).attr("href"), {alt:null,width:null,height:null,loading:null,source:"preload"}); for (const raw of srcsetUrls($(el).attr("imagesrcset") || "")) addImage(raw,{alt:null,width:null,height:null,loading:null,source:"preload-srcset"}); });
  const structuredData: StructuredDataBlock[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    const raw = $(el).text(); const types = new Set<string>();
    try {
      const data: unknown = JSON.parse(raw);
      const walk = (node: unknown, depth=0) => { if (depth > 30 || !node || typeof node !== "object") return; if (Array.isArray(node)) { node.forEach(v => walk(v,depth+1)); return; } const item=node as Record<string, unknown>; const t=item["@type"]; if(typeof t === "string") types.add(t); else if(Array.isArray(t)) t.forEach(v => typeof v === "string" && types.add(v)); Object.values(item).forEach(v=>walk(v,depth+1)); };
      walk(data); structuredData.push({types:[...types],valid:true,data,selector:selector(el)});
    } catch { structuredData.push({types:[],valid:false,raw:raw.slice(0,1000)}); }
  });
  const resources: PageResource[] = [];
  $("script[src],link[href],iframe[src],video[src],audio[src],source[src]").each((_, el) => {
    const item=$(el), rel=item.attr("rel") || "", as=item.attr("as");
    if (el.tagName === "link" && !/stylesheet|preload|prefetch|icon|preconnect|dns-prefetch/.test(rel)) return;
    const url=assetUrl(item.attr("src") || item.attr("href"),base); if (!url) return;
    resources.push({url,type:el.tagName === "script" ? "script" : /stylesheet/.test(rel) ? "stylesheet" : as || el.tagName,thirdParty:!sameOrigin(url,base),rel,blocking:el.tagName === "script" ? !item.attr("async") && !item.attr("defer") && item.attr("type") !== "module" : rel === "stylesheet"});
  });
  const issues: NonNullable<PageEvidence["accessibilityIssues"]> = [];
  const issue=(id:string, selector:string, description:string, evidence:string, recommendation:string) => issues.push({id,severity:"medium",selector,description,evidence:evidence.slice(0,1000),recommendation});
  const ids=new Set<string>(); $("[id]").each((_,el)=>{const id=$(el).attr("id")!;if(ids.has(id))issue("duplicate-id",`[id="${id}"]`,"Duplicate element ID",id,"Give each element a unique ID and update references.");ids.add(id);});
  $("input:not([type='hidden']),select,textarea").each((_,el)=>{const node=$(el), id=node.attr("id"), type=node.attr("type"); const labelled=!!node.attr("aria-label") || !!node.attr("aria-labelledby") || node.parents("label").length>0 || !!(id && $("label").toArray().some(l=>$(l).attr("for")===id)); if(!labelled && !["submit","button","reset","image"].includes(type || ""))issue("form-label",selector(el),"Form control has no associated label",$.html(el),"Associate a visible label using for/id or an accessible name.");});
  $("button,iframe").each((_,el)=>{const node=$(el), label=el.tagName === "iframe" ? node.attr("title") : clean(node.text()) || node.attr("aria-label") || node.attr("aria-labelledby") || node.find("img").attr("alt");if(!label)issue(`${el.tagName}-name`,selector(el),`${el.tagName} has no accessible name`,$.html(el),el.tagName === "iframe" ? "Add a descriptive iframe title." : "Provide descriptive button text or an accessible name.");});
  if (!$("main,[role='main']").length) issue("main-landmark","body","No main landmark found","No main element or role=main","Wrap the primary page content in a main landmark.");
  const domNodes=$("*").length;
  const openGraph:Record<string,string>={},twitter:Record<string,string>={}; $("meta").each((_,el)=>{const key=$(el).attr("property") || $(el).attr("name") || "";if(key.startsWith("og:"))openGraph[key.slice(3)]=$(el).attr("content") || "";if(key.startsWith("twitter:"))twitter[key.slice(8)]=$(el).attr("content") || "";});
  const textRoot=$("body").clone(); textRoot.find("script,style,noscript,template,[hidden],[aria-hidden='true']").remove(); const text=clean(textRoot.text());
  const robotsMeta=meta("robots"), xRobotsTag=input.headers["x-robots-tag"] || null;
  const noindex=/noindex|none/i.test(`${robotsMeta} ${xRobotsTag}`);
  const isHtml=/html/i.test(input.contentType);
  return {url:input.finalUrl,finalUrl:input.finalUrl,requestedUrl:input.requestedUrl,depth:input.depth,status:input.status,ok:input.ok,redirected:input.redirected,redirectChain:input.redirectChain,contentType:input.contentType,contentLengthBytes:input.contentLengthBytes,responseTimeMs:input.responseTimeMs,headers:input.headers,
    title,titleLength:title?.length || 0,metaDescription:description,metaDescriptionLength:description?.length || 0,canonical:assetUrl($("link[rel='canonical']").first().attr("href"),base),robotsMeta,xRobotsTag,metaViewport:meta("viewport"),lang:$("html").attr("lang") || null,charset:$("meta[charset]").attr("charset") || null,
    h1:headings.filter(h=>h.level===1).map(h=>h.text),h2Count:headings.filter(h=>h.level===2).length,headings,headingOutlineIssues,openGraph,twitter,hreflang:$("link[hreflang]").toArray().map(el=>({lang:$(el).attr("hreflang")!,href:assetUrl($(el).attr("href"),base) || ""})),structuredData,
    wordCount:text ? text.split(/\s+/).length : 0,textToHtmlRatio:input.body.length ? text.length/input.body.length : 0,contentHash:createHash("sha256").update(text).digest("hex"),visibleText:text.slice(0,30000),links,internalLinkCount:links.filter(l=>l.internal).length,externalLinkCount:links.filter(l=>!l.internal).length,images,resources,domNodes,accessibilityIssues:issues,
    pagination:$("link[rel='next'],link[rel='prev'],a[rel='next'],a[rel='prev']").toArray().map(el=>assetUrl($(el).attr("href"),base)).filter((x):x is string=>!!x),favicon:assetUrl($("link[rel~='icon']").first().attr("href"),base),
    indexable:input.ok && isHtml && !noindex,indexabilityReason:!input.ok ? `HTTP ${input.status}` : !isHtml ? "Not an HTML page" : noindex ? "noindex directive" : null,findings:[],limitations:["HTTP extraction cannot determine computed visibility, contrast, or layout."]};
}
