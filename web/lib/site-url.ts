type SiteEnvironment = Record<string, string | undefined>;

function httpOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const candidate = value.trim();
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves the externally reachable app origin without trusting the internal
 * request URL that Vercel can expose to server-side route handlers.
 */
export function publicSiteUrl(request: Request, env: SiteEnvironment = process.env): string {
  const configured = httpOrigin(env.NEXT_PUBLIC_SITE_URL);
  if (configured) return configured;

  const vercelOrigin = httpOrigin(env.NEXT_PUBLIC_VERCEL_URL || env.VERCEL_BRANCH_URL || env.VERCEL_URL);
  if (vercelOrigin) return vercelOrigin;

  return httpOrigin(request.url) || "http://localhost:3000";
}
