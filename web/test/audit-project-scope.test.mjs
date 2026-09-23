import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const route=readFileSync(new URL('../app/api/audit/route.ts',import.meta.url),'utf8');
const engine=readFileSync(new URL('../lib/audit.ts',import.meta.url),'utf8');
const ui=readFileSync(new URL('../app/audit/page.tsx',import.meta.url),'utf8');
test('audit history and comparisons are filtered by selected project',()=>{
  assert.match(route,/const projectFilter = projectId \? `&project_id=eq\./);
  assert.equal((route.match(/\$\{projectFilter\}/g)||[]).length,2);
  assert.match(ui,/setProjectId\(params\.get\("projectId"\) \|\| ""\)/);
  assert.match(ui,/if \(routeReady\) void loadHistory\(\)/);
  assert.match(ui,/\/api\/audit\$\{projectId \? `\?projectId=/);
});
test('associated audit URL and environment must match the owned project',()=>{
  assert.match(route,/host !== domain && !host\.endsWith\(`\.\$\{domain\}`\)/);
  assert.match(route,/environment && environment !== projects\[0\]\.environment/);
});
test('zero-page crawl is not assigned a fabricated score',()=>{
  assert.match(engine,/if \(stats\.pagesCrawled === 0\) throw new NoCrawlEvidenceError\(\)/);
  assert.match(route,/err instanceof NoCrawlEvidenceError \? 422/);
  assert.match(ui,/This historical audit crawled no pages and has no valid health score/);
});
