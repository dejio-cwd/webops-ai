// Server-only PostgREST boundary. Never import into a client component.
export function databaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Database is not configured.");
  return { url: url.replace(/\/$/, ""), key };
}

export async function database<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, key } = databaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init, cache: "no-store", signal: init.signal || AbortSignal.timeout(15000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { code?: string };
    throw new Error(`Database operation failed (${response.status}${error.code ? `, ${error.code}` : ""}).`);
  }
  const body = await response.text();
  return (body ? JSON.parse(body) : null) as T;
}

export function rpc<T>(name: string, input: Record<string, unknown>): Promise<T> {
  return database<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(input) });
}

export const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
