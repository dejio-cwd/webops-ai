import { createHash } from "node:crypto";

type GuardOptions = { bucket: string; limit?: number; windowMs?: number; maxBodyBytes?: number; requireAuth?: boolean };
export type AuthenticatedActor = { id: string; email?: string; accessToken: string };
type WindowState = { count: number; resetAt: number };
const windows = new Map<string, WindowState>();

function clientKey(request: Request): string { return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown"; }
function cookie(request: Request, name: string): string { const entry = (request.headers.get("cookie") || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`)); return entry ? decodeURIComponent(entry.slice(name.length + 1)) : ""; }
function rejectOversizeBody(request: Request, maxBodyBytes: number): Response | null { const length = Number(request.headers.get("content-length") || 0); return Number.isFinite(length) && length > maxBodyBytes ? Response.json({ error: "Request body is too large." }, { status: 413 }) : null; }
function limitedResponse(windowMs: number) { return Response.json({ error: "Rate limit exceeded. Try again later." }, { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(windowMs / 1000))) } }); }
function localRateLimit(request: Request, options: GuardOptions): Response | null {
  const now = Date.now(); const windowMs = options.windowMs ?? 60_000; const limit = options.limit ?? 20;
  const key = `${options.bucket}:${clientKey(request)}`; const previous = windows.get(key);
  const state = !previous || previous.resetAt <= now ? { count: 0, resetAt: now + windowMs } : previous;
  state.count += 1; windows.set(key, state);
  return state.count <= limit ? null : limitedResponse(state.resetAt - now);
}
async function rateLimit(request: Request, options: GuardOptions): Promise<Response | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const windowMs = options.windowMs ?? 60_000; const limit = options.limit ?? 20;
  if (!url || !serviceKey) return localRateLimit(request, options);
  const identity = createHash("sha256").update(clientKey(request)).digest("hex");
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/consume_rate_limit`, { method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_bucket_key: `${options.bucket}:${identity}`, p_limit: limit, p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)) }), cache: "no-store", signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return localRateLimit(request, options);
    const allowed = await response.json() as boolean;
    return allowed ? null : limitedResponse(windowMs);
  } catch { return localRateLimit(request, options); }
}
function checkOrigin(request: Request): Response | null { const origin = request.headers.get("origin"); return !origin || origin === new URL(request.url).origin ? null : Response.json({ error: "Cross-origin request blocked." }, { status: 403 }); }
async function authenticate(request: Request): Promise<AuthenticatedActor | Response> {
  const header = request.headers.get("authorization") || ""; const accessToken = header.startsWith("Bearer ") ? header.slice(7).trim() : cookie(request, "webops_access");
  if (!accessToken) return Response.json({ error: "Authentication required." }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return Response.json({ error: "Authentication service is not configured." }, { status: 503 });
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return Response.json({ error: "Invalid or expired session." }, { status: 401 });
    const user = await response.json() as { id?: string; email?: string };
    return user.id ? { id: user.id, email: user.email, accessToken } : Response.json({ error: "Invalid session." }, { status: 401 });
  } catch { return Response.json({ error: "Authentication service unavailable." }, { status: 503 }); }
}
export async function guardApiRequest(request: Request, options: GuardOptions): Promise<AuthenticatedActor | null | Response> {
  const bodyError = rejectOversizeBody(request, options.maxBodyBytes ?? 64_000); if (bodyError) return bodyError;
  const originError = checkOrigin(request); if (originError) return originError;
  const limitError = await rateLimit(request, options); if (limitError) return limitError;
  const enforce = options.requireAuth ?? process.env.SECURITY_ENFORCE_AUTH === "true";
  return enforce ? authenticate(request) : null;
}
export function isGuardResponse(value: unknown): value is Response { return value instanceof Response; }
