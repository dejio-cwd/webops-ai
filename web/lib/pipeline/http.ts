import { validateTarget } from "../ssrf";
import type { AuditConfig } from "./config";
export interface HttpEvidence {
  url: string; status: number; headers: Record<string, string>; bytes: Buffer;
  durationMs: number; truncated: boolean; redirects: { url: string; status: number }[];
}
export async function fetchEvidence(url: string, config: Pick<AuditConfig, "timeoutMs" | "userAgent" | "maxBytes">, options: { method?: "GET" | "HEAD"; maxBytes?: number } = {}): Promise<HttpEvidence> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const started = Date.now();
  const redirects: HttpEvidence["redirects"] = [];
  const visited = new Set<string>();
  try {
    for (let hop = 0; hop < 10; hop++) {
      if (visited.has(url)) throw new Error("Redirect loop detected.");
      visited.add(url);
      const target = await validateTarget(url);
      const response = await fetch(target, { method: options.method || "GET", redirect: "manual", signal: controller.signal, headers: { "User-Agent": config.userAgent, Accept: "*/*" } });
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        redirects.push({ url, status: response.status });
        url = new URL(response.headers.get("location")!, url).href;
        await response.body?.cancel(); continue;
      }
      const cap = options.maxBytes ?? config.maxBytes;
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = []; let length = 0; let truncated = false;
      if (reader) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const remaining = cap - length;
            chunks.push(value.subarray(0, remaining)); length += Math.min(value.byteLength, remaining);
            if (value.byteLength > remaining || length >= cap) { truncated = true; await reader.cancel(); break; }
          }
        } finally { reader.releaseLock(); }
      }
      return { url, status: response.status, headers: Object.fromEntries(response.headers), bytes: Buffer.concat(chunks, length), truncated, durationMs: Date.now() - started, redirects };
    }
    throw new Error("Redirect limit reached.");
  } finally { clearTimeout(timer); }
}
