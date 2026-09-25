export const AUDIT_MODES = ["Quick Audit", "Standard Audit", "Deep Crawl", "Full Technical Audit", "SEO Audit", "Performance Audit", "Image Audit", "Accessibility Audit", "AI Content Audit", "God Mode"] as const;
export type AuditMode = typeof AUDIT_MODES[number];
export interface AuditConfig {
  version: 1; mode: AuditMode; maxPages: number; maxDepth: number; concurrency: number;
  timeoutMs: number; retries: number; delayMs: number; userAgent: string;
  rendering: "http" | "adaptive" | "browser"; viewport: { width: number; height: number; deviceScaleFactor: number; mobile: boolean };
  queryPolicy: "preserve" | "strip-tracking" | "drop"; includePatterns: string[]; excludePatterns: string[];
  respectRobots: boolean; checkExternalLinks: boolean;
  images: boolean; performance: boolean; accessibility: boolean; resources: boolean; ai: boolean;
  credentialId: string; model: string; maxImages: number; maxResources: number; maxAiTasks: number; maxPerformancePages: number;
  maxSitemaps: number; maxBytes: number; maxImageBytes: number; scrollSteps: number;
  largeImageBytes: number; minWords: number; oversizedRatio: number; maxDomNodes: number;
  scoreWeights: Record<string, number>;
}
export const DEFAULT_CONFIG: AuditConfig = {
  version: 1, mode: "Standard Audit", maxPages: 50, maxDepth: 4, concurrency: 4,
  timeoutMs: 15000, retries: 2, delayMs: 300, userAgent: "WebOpsAI/2.0 (+website audit bot)",
  rendering: "adaptive", viewport: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  queryPolicy: "strip-tracking", includePatterns: [], excludePatterns: [], respectRobots: true, checkExternalLinks: true,
  images: true, performance: false, accessibility: true, resources: true, ai: false,
  credentialId: "", model: "", maxImages: 500, maxResources: 1000, maxAiTasks: 20, maxPerformancePages: 3,
  maxSitemaps: 50, maxBytes: 3000000, maxImageBytes: 12000000, scrollSteps: 4,
  largeImageBytes: 300000, minWords: 200, oversizedRatio: 1.5, maxDomNodes: 1500,
  scoreWeights: { seo: 25, indexability: 20, images: 15, accessibility: 10, links: 10, content: 10, "structured-data": 5, performance: 5 },
};
export function modeConfig(mode: AuditMode): AuditConfig {
  const c = structuredClone(DEFAULT_CONFIG); c.mode = mode;
  if (mode === "Quick Audit") Object.assign(c, { maxPages: 10, maxDepth: 2, rendering: "http", maxImages: 50, resources: false });
  if (mode === "Deep Crawl") Object.assign(c, { maxPages: 1000, maxDepth: 12 });
  if (mode === "Performance Audit") Object.assign(c, { maxPages: 10, performance: true, maxPerformancePages: 10, rendering: "browser" });
  if (mode === "Image Audit") Object.assign(c, { maxImages: 2000, rendering: "browser" });
  if (mode === "Accessibility Audit") c.rendering = "browser";
  if (mode === "AI Content Audit") c.ai = true;
  if (mode === "Full Technical Audit" || mode === "God Mode") Object.assign(c, { maxPages: 300, performance: true, rendering: "browser" });
  if (mode === "God Mode") c.ai = true;
  return c;
}
export function normalizeConfig(input: Partial<AuditConfig> = {}): AuditConfig {
  const mode = AUDIT_MODES.includes(input.mode as AuditMode) ? input.mode! : "Standard Audit";
  const c = { ...modeConfig(mode), ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)), mode, version: 1 } as AuditConfig;
  const limits: Partial<Record<keyof AuditConfig, [number, number]>> = { maxPages: [1, 5000], maxDepth: [0, 30], concurrency: [1, 8], timeoutMs: [1000, 45000], retries: [0, 5], delayMs: [0, 30000], maxImages: [0, 20000], maxResources: [0, 20000], maxAiTasks: [0, 500], maxPerformancePages: [0, 100], maxSitemaps: [1, 500], maxBytes: [10000, 10000000], maxImageBytes: [10000, 25000000], scrollSteps: [0, 20], largeImageBytes: [1000, 25000000], minWords: [0, 5000], oversizedRatio: [1, 10], maxDomNodes: [100, 50000] };
  for (const [key, [min, max]] of Object.entries(limits)) {
    const value = Number(c[key as keyof AuditConfig]);
    Object.assign(c, { [key]: Number.isFinite(value) ? Math.min(max, Math.max(min, key === "oversizedRatio" ? value : Math.round(value))) : DEFAULT_CONFIG[key as keyof AuditConfig] });
  }
  for (const k of ["images", "performance", "accessibility", "resources", "ai", "checkExternalLinks"] as const) c[k] = c[k] === true;
  c.respectRobots = true;
  c.rendering = ["http", "adaptive", "browser"].includes(c.rendering) ? c.rendering : "adaptive";
  c.queryPolicy = ["preserve", "strip-tracking", "drop"].includes(c.queryPolicy) ? c.queryPolicy : "strip-tracking";
  for (const k of ["includePatterns", "excludePatterns"] as const) c[k] = Array.isArray(c[k]) ? c[k].filter(v => typeof v === "string").map(v => v.slice(0, 200)).slice(0, 30) : [];
  c.userAgent = typeof c.userAgent === "string" ? c.userAgent.replace(/[\r\n]/g, "").slice(0, 200) || DEFAULT_CONFIG.userAgent : DEFAULT_CONFIG.userAgent;
  c.credentialId = typeof c.credentialId === "string" ? c.credentialId.slice(0, 36) : "";
  c.model = typeof c.model === "string" ? c.model.slice(0, 150) : "";
  const v = { ...DEFAULT_CONFIG.viewport, ...input.viewport };
  c.viewport = { width: Math.min(3840, Math.max(320, Number(v.width) || 1440)), height: Math.min(2160, Math.max(400, Number(v.height) || 900)), deviceScaleFactor: Math.min(3, Math.max(1, Number(v.deviceScaleFactor) || 1)), mobile: v.mobile === true };
  c.scoreWeights = Object.fromEntries(Object.entries(DEFAULT_CONFIG.scoreWeights).map(([key, value]) => [key, Math.min(100, Math.max(0, Number(input.scoreWeights?.[key] ?? value) || 0))]));
  return c;
}

export function crawlUrl(raw: string, base: string, config: AuditConfig): string | null {
  try {
    const u = new URL(raw, base);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.href.length > 4000) return null;
    u.hash = "";
    if (config.queryPolicy === "drop") u.search = "";
    if (config.queryPolicy === "strip-tracking") for (const key of [...u.searchParams.keys()]) if (/^(utm_|gclid$|fbclid$|mc_[ce]id$|_ga$)/i.test(key)) u.searchParams.delete(key);
    if (config.queryPolicy !== "preserve") u.searchParams.sort();
    const glob = (pattern: string) => new RegExp(`^${pattern.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(u.href);
    if (config.excludePatterns.some(glob) || (config.includePatterns.length && !config.includePatterns.some(glob))) return null;
    return u.href;
  } catch { return null; }
}
