// AI provider abstraction with BYOK. Keys live ONLY in server-side env vars
// (never shipped to the browser, never logged). Responses are grounded: the
// model is told to use only the evidence we pass and to say when it is unsure.
//
// Supported via env keys (set any one):
//   OPENROUTER_API_KEY  - OpenRouter (default; free models available)
//   OPENAI_API_KEY      - OpenAI
//   GROQ_API_KEY        - Groq
//   ANTHROPIC_API_KEY   - Anthropic
//   GOOGLE_API_KEY      - Google Gemini
// Optional: AI_PROVIDER, AI_MODEL to pin defaults.

export type Provider = "openrouter" | "openai" | "groq" | "anthropic" | "google";

interface ProviderConfig {
  key: string | undefined;
  defaultModel: string;
  kind: "openai" | "anthropic" | "google";
  baseUrl?: string;
}

function providers(): Record<Provider, ProviderConfig> {
  return {
    openrouter: {
      key: process.env.OPENROUTER_API_KEY,
      defaultModel: process.env.AI_MODEL || "meta-llama/llama-3.3-70b-instruct:free",
      kind: "openai",
      baseUrl: "https://openrouter.ai/api/v1",
    },
    openai: {
      key: process.env.OPENAI_API_KEY,
      defaultModel: process.env.AI_MODEL || "gpt-4o-mini",
      kind: "openai",
      baseUrl: "https://api.openai.com/v1",
    },
    groq: {
      key: process.env.GROQ_API_KEY,
      defaultModel: process.env.AI_MODEL || "llama-3.3-70b-versatile",
      kind: "openai",
      baseUrl: "https://api.groq.com/openai/v1",
    },
    anthropic: {
      key: process.env.ANTHROPIC_API_KEY,
      defaultModel: process.env.AI_MODEL || "claude-3-5-haiku-latest",
      kind: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
    },
    google: {
      key: process.env.GOOGLE_API_KEY,
      defaultModel: process.env.AI_MODEL || "gemini-1.5-flash",
      kind: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    },
  };
}

export function availableProviders(): Provider[] {
  const p = providers();
  return (Object.keys(p) as Provider[]).filter((k) => p[k].key);
}

export function pickProvider(requested?: string): Provider | null {
  const avail = availableProviders();
  if (!avail.length) return null;
  const envDefault = process.env.AI_PROVIDER as Provider | undefined;
  if (requested && avail.includes(requested as Provider)) return requested as Provider;
  if (envDefault && avail.includes(envDefault)) return envDefault;
  return avail[0];
}

export interface AiRequest {
  system: string;
  user: string;
  model?: string;
  provider?: string;
  maxTokens?: number;
}

export interface AiResponse {
  text: string;
  provider: Provider;
  model: string;
}

export async function generateText(req: AiRequest): Promise<AiResponse> {
  const provider = pickProvider(req.provider);
  if (!provider) {
    throw new Error(
      "No AI provider configured. Add an API key (e.g. OPENROUTER_API_KEY) in your Vercel environment variables.",
    );
  }
  const cfg = providers()[provider];
  const model = req.model || cfg.defaultModel;
  const maxTokens = req.maxTokens ?? 900;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    let text: string;
    if (cfg.kind === "anthropic") text = await callAnthropic(cfg, model, req, maxTokens, controller.signal);
    else if (cfg.kind === "google") text = await callGoogle(cfg, model, req, maxTokens, controller.signal);
    else text = await callOpenAiCompatible(cfg, model, req, maxTokens, controller.signal);
    return { text: text.trim(), provider, model };
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAiCompatible(
  cfg: ProviderConfig,
  model: string,
  req: AiRequest,
  maxTokens: number,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.key}`,
      "HTTP-Referer": "https://github.com/dejio-cwd/webops-ai",
      "X-Title": "WebOps AI",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.2,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI provider error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callAnthropic(
  cfg: ProviderConfig,
  model: string,
  req: AiRequest,
  maxTokens: number,
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
      temperature: 0.2,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.content || []).map((c: { text?: string }) => c.text || "").join("");
}

async function callGoogle(
  cfg: ProviderConfig,
  model: string,
  req: AiRequest,
  maxTokens: number,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/models/${model}:generateContent?key=${cfg.key}`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: req.user }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens },
    }),
  });
  if (!res.ok) throw new Error(`Google AI error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("");
}

/** Fetch the live free-model catalogue from OpenRouter (best-effort). */
export async function discoverFreeModels(): Promise<
  { provider: string; id: string; label: string; contextLength?: number }[]
> {
  const key = process.env.OPENROUTER_API_KEY;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const payload = await res.json();
    return (payload.data || [])
      .filter(
        (m: any) => Number(m.pricing?.prompt || 1) === 0 && Number(m.pricing?.completion || 1) === 0,
      )
      .map((m: any) => ({
        provider: "openrouter",
        id: m.id,
        label: m.name || m.id,
        contextLength: m.context_length,
      }));
  } catch {
    return [];
  }
}
