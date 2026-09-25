export type ProviderId = "openrouter" | "openai" | "groq" | "anthropic" | "google" | "custom" | "ollama" | "lmstudio";
export interface AiConnection { id: string; credentialId?: string; label: string; provider: ProviderId; apiKey?: string; baseUrl?: string; model?: string; createdAt: string; lastTestedAt?: string; lastTestOk?: boolean; lastTestMessage?: string }
export type AiTask = "explain" | "fix" | "summary" | "chat";
export interface AiSettings { connections: AiConnection[]; defaultConnectionId: string | null; routing: Partial<Record<AiTask, string>>; crawlDefaults: { maxPages: number; maxDepth: number; concurrency: number; respectRobots: boolean; checkExternalLinks: boolean } }
const KEY = "webops-ai:settings:v3"; const LEGACY_KEY = "webops-ai:settings:v2";
export const CRAWL_LIMITS = { maxPages: 2000, maxDepth: 12, concurrency: 16 };
function defaults(): AiSettings { return { connections: [], defaultConnectionId: null, routing: {}, crawlDefaults: { maxPages: 30, maxDepth: 3, concurrency: 6, respectRobots: true, checkExternalLinks: true } }; }
function withoutSecrets(settings: AiSettings): AiSettings { return { ...settings, connections: settings.connections.map(({ apiKey: _secret, ...connection }) => connection) }; }
export function loadSettings(): AiSettings {
  if (typeof window === "undefined") return defaults();
  try {
    const raw = window.localStorage.getItem(KEY) || window.localStorage.getItem(LEGACY_KEY); if (!raw) return defaults();
    const parsed = JSON.parse(raw); const safe = withoutSecrets({ ...defaults(), ...parsed, crawlDefaults: { ...defaults().crawlDefaults, ...(parsed.crawlDefaults || {}) } });
    window.localStorage.setItem(KEY, JSON.stringify(safe)); window.localStorage.removeItem(LEGACY_KEY); return safe;
  } catch { return defaults(); }
}
export function saveSettings(settings: AiSettings) { if (typeof window === "undefined") return; try { window.localStorage.setItem(KEY, JSON.stringify(withoutSecrets(settings))); window.localStorage.removeItem(LEGACY_KEY); } catch {} }
export function upsertConnection(settings: AiSettings, connection: AiConnection): AiSettings { const exists = settings.connections.some((item) => item.id === connection.id); const connections = exists ? settings.connections.map((item) => item.id === connection.id ? connection : item) : [...settings.connections, connection]; return { ...settings, connections, defaultConnectionId: settings.defaultConnectionId || connection.id }; }
export function removeConnection(settings: AiSettings, id: string): AiSettings { const connections = settings.connections.filter((item) => item.id !== id); const routing = { ...settings.routing }; (Object.keys(routing) as AiTask[]).forEach((task) => { if (routing[task] === id) delete routing[task]; }); return { ...settings, connections, defaultConnectionId: settings.defaultConnectionId === id ? connections[0]?.id ?? null : settings.defaultConnectionId, routing }; }
export function connectionForTask(settings: AiSettings, task: AiTask) { const id = settings.routing[task] || settings.defaultConnectionId; return settings.connections.find((connection) => connection.id === id); }
export function toCredential(connection?: AiConnection | null) { return connection ? { credentialId: connection.credentialId, provider: connection.provider, apiKey: connection.apiKey, baseUrl: connection.baseUrl, model: connection.model } : undefined; }
export function newId() { return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c_${Date.now()}_${Math.random().toString(36).slice(2)}`; }
export const PROVIDER_META: Record<ProviderId, { label: string; needsKey: boolean; localDefault?: string; hint: string }> = {
  openrouter: { label: "OpenRouter", needsKey: true, hint: "One key, hundreds of models — including free ones." }, openai: { label: "OpenAI", needsKey: true, hint: "GPT and o-series models." }, anthropic: { label: "Anthropic", needsKey: true, hint: "Claude family." }, google: { label: "Google Gemini", needsKey: true, hint: "Gemini family." }, groq: { label: "Groq", needsKey: true, hint: "Low-latency open models." }, custom: { label: "Custom endpoint", needsKey: false, hint: "Approved OpenAI-compatible HTTPS endpoint." }, ollama: { label: "Ollama (local bridge)", needsKey: false, localDefault: "http://localhost:11434/v1", hint: "Requires the future local bridge when using hosted WebOps AI." }, lmstudio: { label: "LM Studio (local bridge)", needsKey: false, localDefault: "http://localhost:1234/v1", hint: "Requires the future local bridge when using hosted WebOps AI." },
};
