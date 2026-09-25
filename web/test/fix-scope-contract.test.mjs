import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const api = readFileSync(new URL("../app/api/fixes/route.ts", import.meta.url), "utf8");
const ui = readFileSync(new URL("../app/audit/page.tsx", import.meta.url), "utf8");
test("service-role fix writes validate audit owner, project, opportunity and recrawl", () => {
  assert.match(api, /owner_id=eq\.\$\{encodeURIComponent\(actor\.id\)\}/);
  assert.match(api, /audit_runs\?select=.*\$\{auditScope\}/);
  assert.match(api, /baseline\.project_id !== \(body\.projectId \|\| null\)/);
  assert.match(api, /baseline\.result\?\.opportunities\?\.some/);
  assert.match(api, /verificationCoverage\(baseline\.result, followup\.result, body\.opportunityId\)/);
});
test("UI does not optimistically mark verified without a successful save", () => {
  assert.match(ui, /if \(!response\.ok\) throw new Error/);
  assert.match(ui, /setStates\(\(current\) => \(\{ \.\.\.current, \[opp\.id\]: next \}\)\)/);
  assert.match(ui, /Confirm verified with recrawl evidence/);
  assert.doesNotMatch(ui, /Verified after rerunning the relevant audit rule\./);
});
