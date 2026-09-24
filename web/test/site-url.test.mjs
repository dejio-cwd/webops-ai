import assert from "node:assert/strict";
import { test } from "node:test";
import { publicSiteUrl } from "../lib/site-url.ts";

const internalRequest = new Request("http://localhost:3000/api/auth/signup");

test("explicit site URL takes precedence over an internal Vercel request URL", () => {
  assert.equal(publicSiteUrl(internalRequest, { NEXT_PUBLIC_SITE_URL: "https://webops-ai-red.vercel.app" }), "https://webops-ai-red.vercel.app");
});

test("Preview uses the Vercel deployment URL when no site URL is configured", () => {
  assert.equal(publicSiteUrl(internalRequest, { VERCEL_URL: "webops-preview-abc.vercel.app" }), "https://webops-preview-abc.vercel.app");
});

test("local development retains the request origin", () => {
  assert.equal(publicSiteUrl(new Request("http://localhost:3000/api/auth/signup"), {}), "http://localhost:3000");
});

test("invalid configured values do not become redirect origins", () => {
  assert.equal(publicSiteUrl(new Request("http://localhost:3000/api/auth/signup"), { NEXT_PUBLIC_SITE_URL: "javascript:alert(1)" }), "http://localhost:3000");
});
