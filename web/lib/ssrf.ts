// SSRF protection: validate a target URL before we ever open a connection.
// We block non-HTTP schemes, credentialed URLs, localhost, and any hostname
// that resolves to a private / loopback / link-local / metadata address.
// Every redirect is re-validated by the fetcher using validateTarget again.

import dns from "node:dns/promises";
import net from "node:net";

const BLOCKED_V4: RegExp[] = [
  /^0\./, // "this" network
  /^10\./, // private
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64/10
  /^127\./, // loopback
  /^169\.254\./, // link-local (incl. cloud metadata 169.254.169.254)
  /^172\.(1[6-9]|2\d|3[01])\./, // private
  /^192\.168\./, // private
  /^192\.0\.0\./,
  /^192\.0\.2\./, // TEST-NET
  /^198\.(1[89])\./, // benchmark
  /^198\.51\.100\./, // TEST-NET-2
  /^203\.0\.113\./, // TEST-NET-3
  /^22[4-9]\./, // multicast / reserved
  /^2[3-5]\d\./, // 230-255 reserved
];

export function isPrivateAddress(address: string | undefined | null): boolean {
  if (!address) return true;
  if (net.isIPv4(address)) return BLOCKED_V4.some((re) => re.test(address));
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::" || lower === "::0") return true;
  // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return (
    lower.startsWith("fc") || // unique local
    lower.startsWith("fd") ||
    lower.startsWith("fe8") || // link-local
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("ff") // multicast
  );
}

export class SsrfError extends Error {}

/**
 * Validate a raw URL string and return a parsed URL that is safe to fetch.
 * Throws SsrfError when the target is disallowed.
 */
export async function validateTarget(rawUrl: string): Promise<URL> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new SsrfError("Invalid URL.");
  }
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new SsrfError("Only HTTP and HTTPS URLs are supported.");
  }
  if (target.username || target.password) {
    throw new SsrfError("Credentialed URLs are not allowed.");
  }
  const host = target.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new SsrfError("Local addresses are blocked.");
  }
  // If the host is a literal IP, check it directly.
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new SsrfError("Private network targets are blocked.");
    }
    return target;
  }
  // Otherwise resolve DNS and reject if ANY resolved address is private.
  let records: { address: string }[];
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new SsrfError("Host could not be resolved.");
  }
  if (!records.length || records.some((r) => isPrivateAddress(r.address))) {
    throw new SsrfError("Private or unresolved network targets are blocked.");
  }
  return target;
}
