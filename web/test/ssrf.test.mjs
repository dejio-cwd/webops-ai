import assert from "node:assert/strict";
import { test } from "node:test";
import { isPrivateAddress, validateTarget, SsrfError } from "../web/lib/ssrf.ts";

test("SSRF guard blocks private IPv4 and IPv6 ranges", () => {
  for (const address of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "::1", "::ffff:127.0.0.1", "fd00::1", "fe80::1"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress("8.8.8.8"), false);
});

test("SSRF guard rejects credentialed URLs and disallowed schemes", async () => {
  await assert.rejects(() => validateTarget("file:///etc/passwd"), SsrfError);
  await assert.rejects(() => validateTarget("http://user:pass@example.com"), SsrfError);
  await assert.rejects(() => validateTarget("http://127.0.0.1/"), SsrfError);
});
