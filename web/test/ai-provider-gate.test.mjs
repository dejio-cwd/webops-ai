import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveConfig, AiNotConfiguredError } from "../lib/ai.ts";

const PROVIDER_ENV = ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "AI_PROVIDER", "AI_MODEL"];

test("AI is gated off (not faked) when no provider is configured", () => {
  const saved = {};
  for (const key of PROVIDER_ENV) { saved[key] = process.env[key]; delete process.env[key]; }
  try {
    assert.throws(() => resolveConfig(), (error) => error instanceof AiNotConfiguredError);
  } finally {
    for (const key of PROVIDER_ENV) if (saved[key] !== undefined) process.env[key] = saved[key];
  }
});

test("a BYOK credential resolves to a runnable provider config", () => {
  const cfg = resolveConfig({ provider: "openai", apiKey: "sk-test-key" });
  assert.equal(cfg.provider, "openai");
  assert.equal(cfg.source, "byok");
  assert.ok(cfg.baseUrl);
  assert.equal(cfg.key, "sk-test-key");
});

test("a server env provider key is used as the fallback", () => {
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-env-key";
  try {
    const cfg = resolveConfig(undefined, "openai");
    assert.equal(cfg.provider, "openai");
    assert.equal(cfg.source, "env");
  } finally {
    if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved;
  }
});
