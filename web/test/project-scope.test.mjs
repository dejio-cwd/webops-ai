import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const source=readFileSync(new URL('../app/api/projects/route.ts',import.meta.url),'utf8');
test('project updates and deletes require matching project/org and an affected row',()=>{
  assert.equal(source.match(/projectInOrganization\(config, projectId, organizationId\)/g)?.length,2);
  assert.match(source,/const deleted = await response\.json\(\) as Array<\{ id: string \}>;/);
  assert.match(source,/if \(!deleted\.length\).*status: 404/);
  assert.match(source,/if \(!projects\.length\).*status: 404/);
  assert.doesNotMatch(source,/method: "DELETE", headers: headers\(config\.serviceKey, "return=minimal"\)/);
});
