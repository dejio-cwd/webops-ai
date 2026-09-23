import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const source=readFileSync(new URL('../app/workspace/page.tsx',import.meta.url),'utf8');
test('project selector stays mounted across tenant switches',()=>{
  assert.doesNotMatch(source,/visibleProjects\.length > 1 && \(\s*<select/);
  assert.match(source,/aria-label="Select project"[\s\S]*disabled=\{visibleProjects\.length <= 1\}/);
  assert.match(source,/value=\{activeProject\?\.id \|\| ""\}/);
});
