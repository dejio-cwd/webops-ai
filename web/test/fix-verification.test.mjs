import assert from "node:assert/strict";
import { test } from "node:test";
import { verificationCoverage } from "../lib/fix-verification.ts";
const baseline = { opportunities: [{ id: "SEO-META-MISSING", affectedUrls: ["https://example.com/a", "https://example.com/b"] }] };
const followup = { crawl: { truncated: false }, pages: ["https://example.com/a", "https://example.com/b"].map(url => ({url,ok:true,status:200})), findings: [] };
test("requires every affected URL to be successfully recrawled", () => {
  assert.equal(verificationCoverage(baseline, followup, "SEO-META-MISSING").valid, true);
  assert.equal(verificationCoverage(baseline, { ...followup, pages: followup.pages.slice(0, 1) }, "SEO-META-MISSING").valid, false);
  assert.equal(verificationCoverage(baseline, { ...followup, crawl: { truncated: true } }, "SEO-META-MISSING").valid, false);
});
test("cannot verify a persisting or unknown finding", () => {
  assert.equal(verificationCoverage(baseline, {...followup,findings:[{ruleId:"SEO-META-MISSING",url:"https://example.com/a"}]}, "SEO-META-MISSING").valid,false);
  assert.equal(verificationCoverage(baseline,followup,"INVENTED").valid,false);
});
