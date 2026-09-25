import { runRules } from "../rules";
import { runIntelligenceRules } from "../intelligence";
import { buildOpportunities } from "../opportunities";
import { computeHealth, grade } from "../score";
import { database, rpc } from "../database";
import { recordBatches, saveRecords, getProgress, updateJob } from "./store";
import { collectImageFindings, evidenceRecord, findingRecords } from "./tasks";
import type { AuditJob } from "./types";
import type { CrawlStats, Finding, FindingCategory, PageEvidence, PageImage } from "../types";

function expandedFindings(page: PageEvidence, job: AuditJob): Finding[] {
  const found: Finding[] = [];
  const add = (ruleId: string, category: FindingCategory, title: string, evidence: string, recommendation: string, severity: Finding["severity"] = "medium", element?: string) => found.push({ ruleId, ruleVersion:"2", category, severity, title, detail:title, why:"This observation may affect discoverability or usability. Review the supplied page evidence.", evidence, recommendation, url:page.url, element });
  if (page.status===200 && page.wordCount < job.config.minWords && /not found|page unavailable|does not exist|404/i.test(`${page.title} ${page.h1.join(" ")}`)) add("SEO-SOFT404","indexability","Possible soft 404","HTTP 200 with not-found language and little content","Return a real 404/410 if the page is gone, or restore its intended content.");
  if ((page.domNodes || 0)>job.config.maxDomNodes) add("DOM-SIZE","performance","DOM exceeds the selected threshold",`${page.domNodes} elements; threshold ${job.config.maxDomNodes}`,"Simplify repeated markup and measure the effect on rendering.","low");
  for (const link of page.links) {
    if (!link.anchor) add("LINK-EMPTY","links","Link has no observed accessible text",link.href,"Give the link meaningful text or an accessible name.","medium",link.selector);
    else if (/^(click here|here|read more|learn more)$/i.test(link.anchor)) add("LINK-GENERIC","links","Link text lacks standalone context",`${link.anchor} → ${link.href}`,"Use descriptive link text where it helps users understand the destination.","low",link.selector);
  }
  if (job.config.accessibility) for (const issue of page.accessibilityIssues || []) add(`A11Y-${issue.id}`,"accessibility",issue.description,issue.evidence,issue.recommendation,issue.severity as Finding["severity"],issue.selector);
  const seen = new Set<string>();
  const recommended: Record<string,string[]> = { Product:["name","image","offers"], Article:["headline","author","datePublished"], NewsArticle:["headline","author","datePublished"], Organization:["name","url"], BreadcrumbList:["itemListElement"], FAQPage:["mainEntity"] };
  for (const block of page.structuredData) {
    if (!block.valid) continue;
    const json=JSON.stringify(block.data);
    if (seen.has(json)) add("SCHEMA-DUPLICATE","structured-data","Duplicate JSON-LD block",block.types.join(", "),"Remove identical duplicates after checking how your plugins generate structured data.","low",block.selector);
    seen.add(json);
    const walk=(node:unknown,depth=0)=>{if(!node || typeof node!=="object" || depth>20)return;if(Array.isArray(node)){node.forEach(n=>walk(n,depth+1));return;}const item=node as Record<string,unknown>;const types=Array.isArray(item["@type"])?item["@type"]:[item["@type"]];for(const type of types){if(typeof type!=="string")continue;const missing=(recommended[type]||[]).filter(key=>item[key]===undefined);if(missing.length)add("SCHEMA-RECOMMENDED","structured-data",`${type} lacks useful properties`,missing.join(", "),"Review these recommended properties against the actual page content; this is not a guarantee of rich-result eligibility.","low",block.selector);}Object.values(item).forEach(value=>walk(value,depth+1));};
    walk(block.data);
  }
  return found;
}

export async function finalizeAudit(job: AuditJob) {
  await updateJob(job.id,{stage:"analyzing"});
  const pages: PageEvidence[] = [];
  for await (const batch of recordBatches<PageEvidence>(job.id,"pages")) pages.push(...batch.map(r=>r.data));
  const progress=await getProgress(job.id);
  const successful=pages.filter(p=>p.ok && /html/i.test(p.contentType));
  const restricted = await database<{key:string}[]>(`audit_records?job_id=eq.${job.id}&kind=eq.restrictions&select=key&limit=1`);
  const stats: CrawlStats={requestedUrl:job.url,origin:new URL(job.url).origin,startedAt:job.created_at,finishedAt:new Date().toISOString(),durationMs:Date.now()-Date.parse(job.created_at),pagesCrawled:pages.length,pagesRequested:pages.length,maxPages:job.config.maxPages,maxDepth:job.config.maxDepth,fromSitemap:0,robotsFound:!!job.robots?.found,sitemapFound:false,statusCounts:{},brokenLinks:[],truncated:!!job.summary.limited || progress.failed>0 || restricted.length>0};
  for (const p of pages) stats.statusCounts[p.status]=(stats.statusCounts[p.status]||0)+1;
  const sitemapEvidence = await database<{key:string}[]>(`audit_records?job_id=eq.${job.id}&kind=eq.sitemap_urls&select=key&limit=1`);
  stats.sitemapFound = sitemapEvidence.length > 0;
  const rulePages = pages.map(page => ({...page, images:page.images.filter(image => !image.source || ["img","lazy","srcset","picture","rendered"].includes(image.source))}));
  const findings=[...runRules(rulePages,stats,job.url),...runIntelligenceRules(pages),...pages.flatMap(p=>expandedFindings(p,job))];
  // No array-position guesses about which image is above the fold.
  const certain = findings.filter(f=>!/LAZY/i.test(f.ruleId));
  const targetPages=new Map(pages.map(p=>[p.requestedUrl,p]));
  for await (const batch of recordBatches<{status:number;finalUrl:string;redirects:unknown[]}>(job.id,"link_targets")) {
    for (const row of batch) if (row.data.status>=400 || row.data.redirects.length>1) {
      const links=await database<{source_url:string;data:{anchor:string;selector?:string}}[]>(`audit_records?job_id=eq.${job.id}&kind=eq.links&url=eq.${encodeURIComponent(row.url)}&limit=1000`);
      certain.push(...links.map(link=>({ruleId:row.data.status>=400?"LINK-TARGET-FAILED":"LINK-CHAIN",ruleVersion:"2",category:"links" as const,severity:"medium" as const,title:row.data.status>=400?"Linked URL returns an error":"Link follows multiple redirects",detail:`HTTP ${row.data.status}`,why:"Avoid broken destinations and unnecessary redirect hops.",recommendation:"Update the link to a working final URL.",url:link.source_url,element:link.data.selector,evidence:`${row.url} → ${row.data.finalUrl}`})));
    }
  }
  const sitemapUrls=new Set<string>();
  for await (const batch of recordBatches<{lastmod:string|null;sitemap:string}>(job.id,"sitemap_urls")) for(const row of batch){
    sitemapUrls.add(row.url); const page=targetPages.get(row.url);
    if(page && (!page.indexable || (page.canonical && page.canonical!==page.url)))certain.push({ruleId:"SITEMAP-INDEXABILITY",ruleVersion:"2",category:"indexability",severity:"medium",title:"Sitemap URL has conflicting indexability",detail:page.indexabilityReason || "Canonical points elsewhere",why:"Sitemaps should identify preferred indexable pages.",recommendation:"Align the sitemap, canonical URL and indexing directives.",url:row.url,evidence:`${row.data.sitemap}; canonical ${page.canonical || "missing"}`});
  }
  stats.fromSitemap=sitemapUrls.size;stats.sitemapFound=sitemapUrls.size>0;
  await saveRecords(job.id,findingRecords(certain));
  for await (const usages of recordBatches<PageImage>(job.id,"image_usage")) await saveRecords(job.id,await collectImageFindings(job,usages));
  const allFindings: Finding[]=[];
  for await (const batch of recordBatches<Finding>(job.id,"findings")) allFindings.push(...batch.map(row=>({...row.data,id:row.key,status:row.status as Finding["status"]})));
  const health=successful.length ? computeHealth(allFindings,successful.length) : null;
  if(health){
    if(!job.config.images)delete health.categories.images;
    if(!job.config.accessibility)delete health.categories.accessibility;
    delete health.categories.performance;
    const scores:number[]=[];
    for await(const batch of recordBatches<{scores?:{performance:number|null}}>(job.id,"performance"))for(const row of batch)if(typeof row.data.scores?.performance==="number")scores.push(row.data.scores.performance);
    if(scores.length)health.categories.performance=Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);
    let sum=0,weight=0;for(const [key,value]of Object.entries(health.categories)){const w=job.config.scoreWeights[key]||0;sum+=value!*w;weight+=w;}health.overall=weight?Math.round(sum/weight):0;health.grade=grade(health.overall);
  }
  const opportunities=buildOpportunities(allFindings,successful.length);
  await saveRecords(job.id,opportunities.map(opp=>({...evidenceRecord("opportunities",job.url,opp,undefined,opp.id),title:opp.title,category:opp.category,severity:opp.severity})));
  const summary={...job.summary,health,healthScore:health?.overall ?? null,pagesCrawled:pages.length,successfulPages:successful.length,findings:allFindings.length,opportunities:opportunities.length,progress,crawl:stats,coverage:{renderedPages:pages.filter(p=>p.rendered).length,restricted:restricted.length>0,partial:stats.truncated,performanceMeasured:typeof health?.categories.performance === "number"},findingCountsByCategory:count(allFindings.map(f=>f.category)),findingCountsBySeverity:count(allFindings.map(f=>f.severity))};
  await saveRecords(job.id,[evidenceRecord("reports",job.url,{summary,priorities:opportunities.slice(0,20),generatedAt:new Date().toISOString(),limitations:"Scores summarize collected evidence; unmeasured categories are excluded. Partial coverage is not proof that an unfetched issue was fixed."})]);
  await rpc("finalize_audit_job",{p_job:job.id,p_summary:summary,p_success:successful.length>0,p_partial:stats.truncated});
}
function count(values:string[]){const out:Record<string,number>={};for(const v of values)out[v]=(out[v]||0)+1;return out;}
