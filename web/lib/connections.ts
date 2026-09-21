// Client-side BYOK connection store. Keys live ONLY in this browser's
// localStorage and are sent directly, per-request, to our own API routes,
// which forward them straight to the provider — never persisted server-side,
// never logged. Clearing site data / localStorage removes them completely.

export type ProviderId =
  | "openrouter"
  | "openai"
  | "groq"
  | "anthropic"
  | "google"
  | "custom"
  | "ollama"
  | "lmstudio";

export interface AiConnection {
  id: string;
  label: string;
  provider: ProviderId;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  createdAt: string;
  lastTestedAt?: string;
  lastTestOk?: boolean;
  lastTestMessage?: string;
}

export type AiTask = "explain" | "fix" | "summary" | "chat";

export interface AiSettings {
  connections: AiConnection[];
  defaultConnectionId: string | null;
  routing: Partial<Record<AiTask, string>>; // task -> connection id
  crawlDefaults: {
    maxPages: number;
    maxDepth: number;
    concurrency: number;
    respectRobots: boolean;
    checkExternalLinks: boolean;
  };
}

const KEY = "webops-ai:settings:v2";

export const CRAWL_LIMITS = { maxPages: 2000, maxDepth: 12, concurrency: 16 };

function defaults(): AiSettings {
  return {
    connections: [],
    defaultConnectionId: null,
    routing: {},
    crawlDefaults: { maxPages: 30, maxDepth: 3, concurrency: 6, respectRobots: true, checkExternalLinks: true },
  };
}

export function loadSettings(): AiSettings {
  if (typeof window === "undefined") return defaults();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw);
    return { ...defaults(), ...parsed, crawlDefaults: { ...defaults().crawlDefaults, ...(parsed.crawlDefaults || {}) } };
  } catch {
    return defaults();
  }
}

export function saveSettings(s: AiSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // localStorage unavailable (private mode, quota) — settings simply won't persist.
  }
}

export function upsertConnection(s: AiSettings, conn: AiConnection): AiSettings {
  const exists = s.connections.some((c) => c.id === conn.id);
  const connections = exists ? s.connections.map((c) => (c.id === conn.id ? conn : c)) : [...s.connections, conn];
  const defaultConnectionId = s.defaultConnectionId || conn.id;
  return { ...s, connections, defaultConnectionId };
}

export function removeConnection(s: AiSettings, id: string): AiSettings {
  const connections = s.connections.filter((c) => c.id !== id);
  const defaultConnectionId = s.defaultConnectionId === id ? connections[0]?.id ?? null : s.defaultConnectionId;
  const routing = { ...s.routing };
  (Object.keys(routing) as AiTask[]).forEach((t) => {
    if (routing[t] === id) delete routing[t];
  });
  return { ...s, connections, defaultConnectionId, routing };
}

export function connectionForTask(s: AiSettings, task: AiTask): AiConnection | undefined {
  const id = s.routing[task] || s.defaultConnectionId;
  return s.connections.find((c) => c.id === id);
}

/** Shape expected by every /api/ai* route's `credential` field. */
export function toCredential(conn?: AiConnection | null) {
  if (!conn) return undefined;
  return { provider: conn.provider, apiKey: conn.apiKey, baseUrl: conn.baseUrl, model: conn.model };
}

export function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export const PROVIDER_META: Record<ProviderId, { label: string; needsKey: boolean; localDefault?: string; hint: string }> = {
  openrouter: { label: "OpenRouter", needsKey: true, hint: "One key, hundreds of models — including free ones." },
  openai: { label: "OpenAI", needsKey: true, hint: "GPT-4o, GPT-4o-mini, o-series." },
  anthropic: { label: "Anthropic", needsKey: true, hint: "Claude family." },
  google: { label: "Google Gemini", needsKey: true, hint: "Gemini 1.5 / 2.0 family." },
  groq: { label: "Groq", needsKey: true, hint: "Ultra low-latency open models." },
  custom: { label: "Custom endpoint", needsKey: false, hint: "Any OpenAI-compatible API: Azure OpenAI, Bedrock gateway, vLLM, LiteLLM, a proxy..." },
  ollama: { label: "Ollama (local)", needsKey: false, localDefault: "http://localhost:11434/v1", hint: "Local models on your own machine. No cloud key needed." },
  lmstudio: { label: "LM Studio (local)", needsKey: false, localDefault: "http://localhost:1234/v1", hint: "Local models via LM Studio's server." },
};
