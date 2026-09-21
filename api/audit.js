import dns from 'node:dns/promises';
import net from 'node:net';

const blockedV4 = [
  /^127\./, /^10\./, /^169\.254\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./, /^0\./
];

export function isPrivateAddress(address) {
  if (!address) return true;
  if (net.isIPv4(address)) return blockedV4.some((pattern) => pattern.test(address));
  const lower = address.toLowerCase();
  return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:') || lower.startsWith('::ffff:127.') || lower.startsWith('::ffff:10.') || lower.startsWith('::ffff:192.168.');
}

export async function validateTarget(rawUrl) {
  const target = new URL(rawUrl);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
  if (target.username || target.password) throw new Error('Credentialed URLs are not allowed.');
  if (target.hostname === 'localhost' || target.hostname.endsWith('.localhost')) throw new Error('Local addresses are blocked.');
  const records = await dns.lookup(target.hostname, { all: true, verbatim: true });
  if (!records.length || records.some(({ address }) => isPrivateAddress(address))) throw new Error('Private or unresolved network targets are blocked.');
  return target;
}

function extract(html, regex) { return html.match(regex)?.[1]?.replace(/\s+/g, ' ').trim() || null; }
function count(html, regex) { return [...html.matchAll(regex)].length; }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
    return res.end(JSON.stringify({ error: 'Use POST.' }));
  }
  try {
    const body = await readJson(req);
    const target = await validateTarget(body.url);
    const started = Date.now();
    const response = await fetch(target, {
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'WebOpsAI-MVP/0.1 (+website-audit)' }
    });
    const contentType = response.headers.get('content-type') || '';
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 2_000_000) throw new Error('Response exceeds the 2 MB MVP limit.');
    const html = contentType.includes('text/html') ? (await response.text()).slice(0, 2_000_000) : '';
    const title = extract(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const description = extract(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || extract(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
    const h1 = extract(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)?.replace(/<[^>]+>/g, '');
    const findings = [];
    if (!title) findings.push({ ruleId: 'SEO-TITLE-001', severity: 'HIGH', title: 'Missing page title' });
    if (!description) findings.push({ ruleId: 'SEO-META-001', severity: 'MEDIUM', title: 'Missing meta description' });
    if (!h1) findings.push({ ruleId: 'SEO-H1-001', severity: 'MEDIUM', title: 'Missing H1 heading' });
    const result = {
      auditId: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      evidence: {
        url: target.href,
        status: response.status,
        responseTimeMs: Date.now() - started,
        contentType,
        contentLength: html.length || contentLength,
        title,
        metaDescription: description,
        h1,
        links: count(html, /<a\b[^>]*href=/gi),
        images: count(html, /<img\b/gi)
      },
      findings
    };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Audit failed.' }));
  }
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 20_000) throw new Error('Request body too large.');
  }
  return JSON.parse(data || '{}');
}
