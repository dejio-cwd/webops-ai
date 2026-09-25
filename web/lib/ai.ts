/* eslint-disable @typescript-eslint/no-explicit-any -- external provider JSON is intentionally normalized at the boundary. */
// AI provider abstraction with full BYOK support.
//
// Two ways to supply credentials:
//  1. Server-side env vars (OPENROUTER_API_KEY, OPENAI_API_KEY, ...) — set once
//     in Vercel, shared by everyone who opens the app.
//  2. A per-request "credential" object sent by the client (built in AI Studio
//     → Settings, stored in the browser's localStorage). This lets each user
//     bring their own key for any provider, plus fully custom OpenAI-compatible
//     endpoints (self-hosted, Azure, Bedrock gateways, Ollama, LM Studio...).
//
// Keys sent by the client are used ONLY to make the outbound request for that
// single call. They are never written to disk, a database, or a log line.

export type KnownProvider =
  "openrouter" | "openai" | "groq" | "anthropic" | "google";
export type ProviderId = KnownProvider | "custom" | "ollama" | "lmstudio";

type Kind = "openai" | "anthropic" | "google";

interface ProviderPreset {
  label: string;
  kind: Kind;
  baseUrl: string;
  defaultModel: string;
  envKey?: string;
  needsKey: boolean;
  listPath?: string; // path (relative to baseUrl) that returns a model list
}

const PRESETS: Record<ProviderId, ProviderPreset> = {
  openrouter: {
    label: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    envKey: "OPENROUTER_API_KEY",
    needsKey: false, // model listing works keyless; chat needs a key
    listPath: "/models",
  },
  openai: {
    label: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    envKey: "OPENAI_API_KEY",
    needsKey: true,
    listPath: "/models",
  },
  groq: {
    label: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    envKey: "GROQ_API_KEY",
    needsKey: true,
    listPath: "/models",
  },
  anthropic: {
    label: "Anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-haiku-latest",
    envKey: "ANTHROPIC_API_KEY",
    needsKey: true,
    listPath: "/models",
  },
  google: {
    label: "Google Gemini",
    kind: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-1.5-flash",
    envKey: "GOOGLE_API_KEY",
    needsKey: true,
    listPath: "/models",
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    kind: "openai",
    baseUrl: "",
    defaultModel: "",
    needsKey: false,
    listPath: "/models",
  },
  ollama: {
    label: "Ollama (local)",
    kind: "openai",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.2",
    needsKey: false,
    listPath: "/models",
  },
  lmstudio: {
    label: "LM Studio (local)",
    kind: "openai",
    baseUrl: "http://localhost:1234/v1",
    defaultModel: "local-model",
    needsKey: false,
    listPath: "/models",
  },
};

/** Credential supplied by the client for a single request. Never persisted server-side. */
export interface Credential {
  provider: ProviderId;
  apiKey?: string;
  baseUrl?: string; // override, required for "custom"
  model?: string;
  label?: string; // user-friendly name, echoed back only
}

export interface ResolvedConfig {
  provider: ProviderId;
  kind: Kind;
  baseUrl: string;
  key?: string;
  model: string;
  source: "byok" | "env";
}

/** Which known providers have a usable server-side env key. */
export function availableProviders(): KnownProvider[] {
  return (Object.keys(PRESETS) as ProviderId[]).filter(
    (p): p is KnownProvider => {
      const preset = PRESETS[p];
      return !!preset.envKey && !!process.env[preset.envKey];
    },
  ) as KnownProvider[];
}

export function providerCatalog() {
  return (Object.keys(PRESETS) as ProviderId[]).map((id) => ({
    id,
    label: PRESETS[id].label,
    needsKey: PRESETS[id].needsKey,
    hasEnvKey: !!PRESETS[id].envKey && !!process.env[PRESETS[id].envKey!],
    defaultModel: PRESETS[id].defaultModel,
    defaultBaseUrl: PRESETS[id].baseUrl,
  }));
}

/** Resolve a runnable config from an optional client credential, falling back to env vars. */
export class AiNotConfiguredError extends Error {
  constructor() {
    super("No AI provider is configured. Add a provider credential in AI Studio (BYOK), or set a server provider key such as OPENROUTER_API_KEY.");
    this.name = "AiNotConfiguredError";
  }
}

export function resolveConfig(
  cred?: Credential | null,
  fallbackProvider?: string,
): ResolvedConfig {
  if (cred && cred.provider) {
    const preset = PRESETS[cred.provider];
    if (!preset) throw new Error(`Unknown provider "${cred.provider}".`);
    const baseUrl = (cred.baseUrl || preset.baseUrl).replace(/\/+$/, "");
    if (!baseUrl) throw new Error("A base URL is required for this provider.");
    const key =
      cred.apiKey || (preset.envKey ? process.env[preset.envKey] : undefined);
    if (preset.needsKey && !key) {
      throw new Error(`${preset.label} requires an API key.`);
    }
    return {
      provider: cred.provider,
      kind: preset.kind,
      baseUrl,
      key,
      model: cred.model || preset.defaultModel,
      source: cred.apiKey ? "byok" : "env",
    };
  }

  // No explicit credential: fall back to whichever env-configured provider is available.
  const avail = availableProviders();
  const envDefault = process.env.AI_PROVIDER as KnownProvider | undefined;
  const chosen =
    (fallbackProvider &&
      avail.includes(fallbackProvider as KnownProvider) &&
      (fallbackProvider as KnownProvider)) ||
    (envDefault && avail.includes(envDefault) && envDefault) ||
    avail[0];
  if (!chosen) {
    throw new AiNotConfiguredError();
  }
  const preset = PRESETS[chosen];
  return {
    provider: chosen,
    kind: preset.kind,
    baseUrl: preset.baseUrl,
    key: process.env[preset.envKey!],
    model: process.env.AI_MODEL || preset.defaultModel,
    source: "env",
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: { mimeType: string; data: string }[];
}

export interface AiRequest {
  system?: string;
  user?: string;
  messages?: ChatMessage[];
  images?: { mimeType: string; data: string }[];
  credential?: Credential | null;
  provider?: string; // legacy convenience: pick an env-configured provider by name
  model?: string; // overrides credential.model / preset default
  maxTokens?: number;
  temperature?: number;
}

export interface AiResponse {
  text: string;
  provider: ProviderId;
  model: string;
  source: "byok" | "env";
}

function buildMessages(req: AiRequest): {
  system: string;
  turns: ChatMessage[];
} {
  if (req.messages && req.messages.length) {
    const sys =
      req.messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n") ||
      req.system ||
      "";
    const turns = req.messages.filter((m) => m.role !== "system");
    return { system: sys, turns };
  }
  return {
    system: req.system || "",
    turns: [{ role: "user", content: req.user || "", images: req.images }],
  };
}

export async function generateText(req: AiRequest): Promise<AiResponse> {
  const cfg = resolveConfig(req.credential, req.provider);
  const model = req.model || cfg.model;
  const maxTokens = req.maxTokens ?? 900;
  const temperature = req.temperature ?? 0.2;
  const { system, turns } = buildMessages(req);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    let text: string;
    if (cfg.kind === "anthropic")
      text = await callAnthropic(
        cfg,
        model,
        system,
        turns,
        maxTokens,
        temperature,
        controller.signal,
      );
    else if (cfg.kind === "google")
      text = await callGoogle(
        cfg,
        model,
        system,
        turns,
        maxTokens,
        temperature,
        controller.signal,
      );
    else
      text = await callOpenAiCompatible(
        cfg,
        model,
        system,
        turns,
        maxTokens,
        temperature,
        controller.signal,
      );
    return {
      text: text.trim(),
      provider: cfg.provider,
      model,
      source: cfg.source,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAiCompatible(
  cfg: ResolvedConfig,
  model: string,
  system: string,
  turns: ChatMessage[],
  maxTokens: number,
  temperature: number,
  signal: AbortSignal,
): Promise<string> {
  const messages = [
    ...(system ? [{ role: "system", content: system }] : []),
    ...turns.map(t => ({ role: t.role, content: t.images?.length ? [{ type: "text", text: t.content }, ...t.images.map(image => ({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } }))] : t.content })),
  ];
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}),
      "HTTP-Referer": "https://github.com/dejio-cwd/webops-ai",
      "X-Title": "WebOps AI",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages,
    }),
  });
  if (!res.ok)
    throw new Error(
      `${cfg.provider} request failed with status ${res.status}.`,
    );
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callAnthropic(
  cfg: ResolvedConfig,
  model: string,
  system: string,
  turns: ChatMessage[],
  maxTokens: number,
  temperature: number,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/messages`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.key!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: turns.map((t) => ({
        role: t.role === "assistant" ? "assistant" : "user",
        content: t.images?.length ? [...t.images.map(image => ({ type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } })), { type: "text", text: t.content }] : t.content,
      })),
    }),
  });
  if (!res.ok)
    throw new Error(`Anthropic request failed with status ${res.status}.`);
  const data = await res.json();
  return (data.content || [])
    .map((c: { text?: string }) => c.text || "")
    .join("");
}

async function callGoogle(
  cfg: ResolvedConfig,
  model: string,
  system: string,
  turns: ChatMessage[],
  maxTokens: number,
  temperature: number,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/models/${model}:generateContent`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.key! },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: turns.map((t) => ({
        role: t.role === "assistant" ? "model" : "user",
        parts: [{ text: t.content }, ...(t.images || []).map(image => ({ inlineData: { mimeType: image.mimeType, data: image.data } }))],
      })),
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    }),
  });
  if (!res.ok)
    throw new Error(`Google AI request failed with status ${res.status}.`);
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || [])
    .map((p: { text?: string }) => p.text || "")
    .join("");
}

export interface ModelInfo {
  id: string;
  label: string;
  contextLength?: number;
  free?: boolean;
  vision?: boolean;
}

/** Live model listing for a resolved provider config. Best-effort — never throws. */
export async function listModels(
  cred?: Credential | null,
  fallbackProvider?: string,
): Promise<ModelInfo[]> {
  try {
    const cfg = resolveConfigForListing(cred, fallbackProvider);
    if (!cfg) return [];
    if (cfg.kind === "google") return listGoogleModels(cfg);
    if (cfg.kind === "anthropic") return listAnthropicModels(cfg);
    return listOpenAiCompatibleModels(cfg);
  } catch {
    return [];
  }
}

// Listing should work even without a key for providers that allow it (OpenRouter, local servers).
function resolveConfigForListing(
  cred?: Credential | null,
  fallbackProvider?: string,
): ResolvedConfig | null {
  try {
    if (cred && cred.provider) {
      const preset = PRESETS[cred.provider];
      if (!preset) return null;
      const baseUrl = (cred.baseUrl || preset.baseUrl).replace(/\/+$/, "");
      if (!baseUrl) return null;
      const key =
        cred.apiKey || (preset.envKey ? process.env[preset.envKey] : undefined);
      return {
        provider: cred.provider,
        kind: preset.kind,
        baseUrl,
        key,
        model: cred.model || preset.defaultModel,
        source: cred.apiKey ? "byok" : "env",
      };
    }
    return resolveConfig(null, fallbackProvider);
  } catch {
    return null;
  }
}

async function listOpenAiCompatibleModels(
  cfg: ResolvedConfig,
): Promise<ModelInfo[]> {
  const res = await fetch(`${cfg.baseUrl}/models`, {
    headers: cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {},
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const payload = await res.json();
  const list = payload.data || payload.models || [];
  return list.map((m: any) => ({
    id: m.id || m.name,
    label: m.name || m.id,
    contextLength: m.context_length ?? m.context_window,
    free:
      cfg.provider === "openrouter"
        ? Number(m.pricing?.prompt || 1) === 0 &&
          Number(m.pricing?.completion || 1) === 0
        : undefined,
    vision: Array.isArray(m.architecture?.input_modalities)
      ? m.architecture.input_modalities.includes("image")
      : undefined,
  }));
}

async function listAnthropicModels(cfg: ResolvedConfig): Promise<ModelInfo[]> {
  if (!cfg.key) return [];
  const res = await fetch(`${cfg.baseUrl}/models`, {
    headers: { "x-api-key": cfg.key, "anthropic-version": "2023-06-01" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const payload = await res.json();
  return (payload.data || []).map((m: any) => ({
    id: m.id,
    label: m.display_name || m.id,
  }));
}

async function listGoogleModels(cfg: ResolvedConfig): Promise<ModelInfo[]> {
  if (!cfg.key) return [];
  const res = await fetch(`${cfg.baseUrl}/models`, {
    headers: { "x-goog-api-key": cfg.key },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const payload = await res.json();
  return (payload.models || [])
    .filter((m: any) =>
      (m.supportedGenerationMethods || []).includes("generateContent"),
    )
    .map((m: any) => ({
      id: String(m.name || "").replace(/^models\//, ""),
      label: m.displayName || m.name,
      contextLength: m.inputTokenLimit,
    }));
}

export interface TestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
  modelsFound?: number;
  provider: ProviderId;
}

/** Validate a credential works: try listing models, then fall back to a 1-token completion. */
export async function testCredential(cred: Credential): Promise<TestResult> {
  const started = Date.now();
  try {
    const cfg = resolveConfig(cred);
    const models = await listModels(cred);
    if (models.length > 0) {
      return {
        ok: true,
        message: `Connected. ${models.length} model(s) available.`,
        latencyMs: Date.now() - started,
        modelsFound: models.length,
        provider: cfg.provider,
      };
    }
    // Some providers don't expose a list endpoint (or it needs no auth check) — do a tiny live call instead.
    await generateText({
      system: "Reply with the single word OK.",
      user: "Say OK.",
      credential: cred,
      maxTokens: 5,
    });
    return {
      ok: true,
      message: "Connected (verified with a live test call).",
      latencyMs: Date.now() - started,
      provider: cfg.provider,
    };
  } catch (err) {
    return {
      ok: false,
      message:
        "Connection failed. Verify the provider, key, endpoint, and model policy.",
      latencyMs: Date.now() - started,
      provider: cred.provider,
    };
  }
}

/** Fetch the live free-model catalogue from OpenRouter (best-effort, keyless-friendly). */
export async function discoverFreeModels(): Promise<ModelInfo[]> {
  const models = await listOpenAiCompatibleModels({
    provider: "openrouter",
    kind: "openai",
    baseUrl: PRESETS.openrouter.baseUrl,
    key: process.env.OPENROUTER_API_KEY,
    model: "",
    source: "env",
  }).catch(() => [] as ModelInfo[]);
  return models.filter((m) => m.free);
}
