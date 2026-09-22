type RestOptions = RequestInit & { accessToken?: string; serviceRole?: boolean };

export async function supabaseRest(path: string, options: RestOptions = {}) {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !anonKey) throw new Error("Supabase is not configured.");
  const { accessToken, serviceRole, ...requestInit } = options;
  const key = serviceRole ? serviceKey : anonKey;
  if (!key) throw new Error("The Supabase service role is not configured.");
  const token = serviceRole ? key : accessToken || key;
  const headers = new Headers(requestInit.headers);
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${baseUrl.replace(/\/$/, "")}${path}`, { ...requestInit, headers, cache: "no-store" });
}

export async function jsonOrError(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.message || data?.msg || data?.error_description || data?.hint || `Supabase request failed (${response.status}).`;
    throw new Error(message);
  }
  return data;
}
