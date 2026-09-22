type RestOptions = RequestInit & { accessToken?: string; serviceRole?: boolean };

export async function supabaseRest(path: string, options: RestOptions = {}) {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !anonKey) throw new Error("Supabase is not configured.");
  const key = options.serviceRole ? serviceKey : anonKey;
  if (!key) throw new Error("The Supabase service role is not configured.");
  const token = options.serviceRole ? key : options.accessToken || key;
  const { accessToken: _accessToken, serviceRole: _serviceRole, headers, ...init } = options;
  return fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(headers || {}) },
    cache: "no-store",
  });
}

export async function jsonOrError(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.message || data?.msg || data?.error_description || data?.hint || `Supabase request failed (${response.status}).`;
    throw new Error(message);
  }
  return data;
}
