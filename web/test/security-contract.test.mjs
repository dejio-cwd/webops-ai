import assert from "node:assert/strict";
import { test } from "node:test";
import { encryptSecret, decryptSecret } from "../lib/security/credential-vault.ts";
import { guardApiRequest } from "../lib/security/api-guard.ts";

process.env.CREDENTIAL_ENCRYPTION_KEY = "test-only-key-with-at-least-32-characters";

test("credential vault encrypts, decrypts, and rejects tampering", () => {
  const encrypted = encryptSecret("provider-secret");
  assert.match(encrypted, /^v1\.[^.]+\.[^.]+\.[^.]+$/);
  assert.notEqual(encrypted, "provider-secret");
  assert.equal(decryptSecret(encrypted), "provider-secret");
  const parts = encrypted.split(".");
  parts[3] = `${parts[3]}x`;
  assert.throws(() => decryptSecret(parts.join(".")), /Stored credential is invalid|Unsupported state|unable to authenticate/i);
});

test("credential vault refuses an undersized encryption root", () => {
  const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = "short";
  assert.throws(() => encryptSecret("secret"), /at least 32 characters/);
  process.env.CREDENTIAL_ENCRYPTION_KEY = previous;
});

test("API guard rejects oversized bodies before downstream work", async () => {
  const response = await guardApiRequest(new Request("https://webops.test/api/ai", { method: "POST", headers: { "content-length": "70000" } }), { bucket: "test", maxBodyBytes: 64000 });
  assert.equal(response?.status, 413);
});

test("API guard rejects cross-origin requests", async () => {
  const response = await guardApiRequest(new Request("https://webops.test/api/ai", { method: "POST", headers: { origin: "https://attacker.test" } }), { bucket: "test-origin" });
  assert.equal(response?.status, 403);
});
