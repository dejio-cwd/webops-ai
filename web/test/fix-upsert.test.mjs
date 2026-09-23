import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const route = readFileSync(new URL("../app/api/fixes/route.ts", import.meta.url), "utf8");
test("Fix Center upsert targets its unique owner/audit/opportunity key", () => {
  assert.match(route, /fix_records\?on_conflict=owner_id,audit_id,opportunity_id/);
  assert.match(route, /resolution=merge-duplicates,return=representation/);
  assert.match(route, /if \(!fix\) return Response\.json\(\{ error: "Fix save returned no record\." \}, \{ status: 502 \}\)/);
});

test("Fix Center scopes shared reads to project membership while limiting writes to writers", () => {
  assert.match(route, /async function projectRole\(/);
  assert.match(route, /const projectId = params\.get\("projectId"\) \|\| "";/);
  assert.match(route, /if \(projectId && !\(await projectRole\(value, projectId, actor\.id\)\)\)/);
  assert.match(route, /project_id=eq\.\$\{encodeURIComponent\(projectId\)\}/);
  assert.match(route, /\["owner", "admin", "developer"\]\.includes\(await projectRole/);
  assert.match(route, /select=owner_id,audit_id,project_id,created_at,status,result/);
  assert.match(route, /owner_id: baseline\.owner_id,/);
});
