import { validateTarget } from "@/lib/ssrf";

const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio"]);

/** Validate every client-controlled AI endpoint before server-side use. */
export async function validateAiCredentialEndpoint(credential: unknown): Promise<void> {
  if (!credential || typeof credential !== "object") return;
  const value = credential as { provider?: unknown; baseUrl?: unknown };
  const provider = typeof value.provider === "string" ? value.provider : "";
  const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl.trim() : "";

  if (LOCAL_PROVIDERS.has(provider) && process.env.NODE_ENV === "production") {
    throw new Error("Local AI providers require the WebOps local bridge and cannot be reached by the hosted service.");
  }
  if (!baseUrl) return;

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("The custom AI endpoint is not a valid URL.");
  }
  if (parsed.username || parsed.password) throw new Error("Credentialed endpoint URLs are not allowed.");
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("Custom AI endpoints must use HTTPS in production.");
  }

  await validateTarget(parsed.href);

  const allowlist = (process.env.AI_CUSTOM_ENDPOINT_ALLOWLIST || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length && !allowlist.includes(parsed.hostname.toLowerCase())) {
    throw new Error("This custom AI endpoint is not approved by the workspace policy.");
  }
}
