// Safe HTTP fetch with manual redirect handling. Every hop is re-validated
// against the SSRF guard so a public URL cannot 302 into a private address
// (DNS-rebinding / redirect-based SSRF).

import { validateTarget, SsrfError } from "./ssrf";

const USER_AGENT =
  "WebOpsAI/1.0 (+https://github.com/dejio-cwd/webops-ai; website audit bot)";
const MAX_BYTES = 3_500_000; // 3.5 MB cap per document
const MAX_REDIRECTS = 8;

export interface FetchResult {
  finalUrl: string;
  status: number;
  ok: boolean;
  redirected: boolean;
  redirectChain: { url: string; status: number }[];
  headers: Record<string, string>;
  contentType: string;
  contentLengthBytes: number;
  responseTimeMs: number;
  body: string;
  error?: string;
}

function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/** Read a response body but stop after MAX_BYTES to avoid memory blowups. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      const chunk = value.subarray(0, MAX_BYTES - total);
      total += chunk.byteLength;
      chunks.push(chunk);
      if (total >= MAX_BYTES) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c.subarray(0, Math.min(c.byteLength, total - offset)), offset);
    offset += c.byteLength;
    if (offset >= total) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

export interface FetchOptions {
  method?: "GET" | "HEAD";
  timeoutMs?: number;
  wantBody?: boolean;
}

export async function safeFetch(
  rawUrl: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const { method = "GET", timeoutMs = 12000, wantBody = true } = opts;
  const redirectChain: { url: string; status: number }[] = [];
  const started = Date.now();
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const target = await validateTarget(current); // throws SsrfError if unsafe
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(target, {
        method,
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
    const status = res.status;
    // Handle redirects manually so we can re-validate each hop.
    if (status >= 300 && status < 400 && res.headers.get("location")) {
      redirectChain.push({ url: target.href, status });
      const next = new URL(res.headers.get("location")!, target).href;
      await res.body?.cancel().catch(() => {});
      current = next;
      continue;
    }

    const headers = headersToObject(res.headers);
    const contentType = res.headers.get("content-type") || "";
    const isHtml =
      contentType.includes("text/html") ||
      contentType.includes("application/xhtml") ||
      contentType.includes("xml");
    const body = wantBody && isHtml ? await readCapped(res) : "";
    if (!body) await res.body?.cancel().catch(() => {});

    return {
      finalUrl: target.href,
      status,
      ok: status >= 200 && status < 400,
      redirected: redirectChain.length > 0,
      redirectChain,
      headers,
      contentType,
      contentLengthBytes:
        Number(res.headers.get("content-length")) || Buffer.byteLength(body),
      responseTimeMs: Date.now() - started,
      body,
    };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new SsrfError("Too many redirects.");
}

export { SsrfError };
