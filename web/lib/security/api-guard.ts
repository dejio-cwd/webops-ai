type GuardOptions = {
  bucket: string;
  limit?: number;
  windowMs?: number;
  requireAuth?: boolean;
};

export type AuthenticatedActor = { id: string; email?: string };

type WindowState = { count: number; resetAt: number };
const windows = new Map<string, WindowState>();

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

function rateLimit(request: Request, options: GuardOptions): Response | null {
  const now = Date.now();
  const windowMs = options.windowMs ?? 60_000;
  const limit = options.limit ?? 20;
  const key = `${options.bucket}:${clientKey(request)}`;
  const previous = windows.get(key);
  const state = !previous || previous.resetAt <= now ? { count: 0, resetAt: now + windowMs } : previous;
  state.count += 1;
  windows.set(key, state);
  if (state.count <= limit) return null;
  return Response.json(
    { error: "Rate limit exceeded. Try again later." },
    { status: 429, headers: { "Retry-After": String(Math.ceil((state.resetAt - now) / 1000)) } },
  );
}

function checkOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const expected = new URL(request.url).origin;
  if (origin !== expected) return Response.json({ error: "Cross-origin request blocked." }, { status: 403 });
  return null;
}

async function authenticate(request: Request): Promise<AuthenticatedActor | Response> {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return Response.json({ error: "Authentication service is not configured." }, { status: 503 });

  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return Response.json({ error: "Invalid or expired session." }, { status: 401 });
    const user = (await response.json()) as { id?: string; email?: string };
    if (!user.id) return Response.json({ error: "Invalid session." }, { status: 401 });
    return { id: user.id, email: user.email };
  } catch {
    return Response.json({ error: "Authentication service unavailable." }, { status: 503 });
  }
}

export async function guardApiRequest(request: Request, options: GuardOptions): Promise<AuthenticatedActor | null | Response> {
  const originError = checkOrigin(request);
  if (originError) return originError;
  const limitError = rateLimit(request, options);
  if (limitError) return limitError;

  const enforce = options.requireAuth ?? process.env.SECURITY_ENFORCE_AUTH === "true";
  if (!enforce) return null;
  return authenticate(request);
}

export function isGuardResponse(value: unknown): value is Response {
  return value instanceof Response;
}
