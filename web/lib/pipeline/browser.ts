import { chromium } from "playwright-core";
import serverChromium from "@sparticuz/chromium";
import AxeBuilder from "@axe-core/playwright";
import { existsSync } from "node:fs";
import { validateTarget } from "../ssrf";
import { buildEvidence } from "../extract";
import { sameOrigin } from "../normalize";
import type { AuditConfig } from "./config";
import type { HttpEvidence } from "./http";

export async function renderPage(http: HttpEvidence, requestedUrl: string, depth: number, config: AuditConfig) {
  await validateTarget(http.url);
  const localChrome = process.platform === "win32" ? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync) : undefined;
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || localChrome || await serverChromium.executablePath();
  const browser = await chromium.launch({ executablePath, args: serverChromium.args, headless: true, timeout: config.timeoutMs });
  const timer = setTimeout(() => { void browser.close().catch(() => {}); }, Math.min(90000, config.timeoutMs * 2));
  try {
    const context = await browser.newContext({ viewport: { width: config.viewport.width, height: config.viewport.height }, deviceScaleFactor: config.viewport.deviceScaleFactor, isMobile: config.viewport.mobile, userAgent: config.userAgent, serviceWorkers: "block", acceptDownloads: false });
    await context.route("**/*", async route => {
      try {
        const target = route.request().url();
        if (!/^https?:/.test(target)) return route.abort();
        await validateTarget(target); await route.continue();
      } catch { await route.abort().catch(() => {}); }
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const readings = { lcp: null as number | null, cls: 0, lcpSrc: "" };
      Object.assign(window, { __webops: readings });
      try { new PerformanceObserver(list => { for (const entry of list.getEntries()) { readings.lcp = entry.startTime; const e = entry as PerformanceEntry & { element?: HTMLImageElement }; readings.lcpSrc = e.element?.currentSrc || e.element?.getAttribute("src") || ""; } }).observe({ type: "largest-contentful-paint", buffered: true }); } catch {}
      let sessionStart = 0, lastShift = 0, sessionScore = 0;
      try { new PerformanceObserver(list => { for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (e.hadRecentInput) continue;
        if (entry.startTime - lastShift >= 1000 || entry.startTime - sessionStart >= 5000) { sessionStart = entry.startTime; sessionScore = 0; }
        lastShift = entry.startTime; sessionScore += e.value || 0; readings.cls = Math.max(readings.cls, sessionScore);
      } }).observe({ type: "layout-shift", buffered: true }); } catch {}
    });
    const response = await page.goto(http.url, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    if (response && [401, 403, 429].includes(response.status())) throw new Error(`Browser access restricted (HTTP ${response.status()}).`);
    await page.waitForLoadState("networkidle", { timeout: Math.min(config.timeoutMs, 5000) }).catch(() => {});
    for (let i = 0; i < config.scrollSteps; i++) { await page.evaluate(() => window.scrollBy(0, innerHeight)); await page.waitForTimeout(200); }
    const snapshot = await page.evaluate(() => {
      const selector = (el: Element) => { const parts: string[] = []; let node: Element | null = el; while (node) { const tag = node.tagName.toLowerCase(); const siblings = Array.from(node.parentElement?.children || []).filter(s => s.tagName === node!.tagName); parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(node) + 1 || 1})`); node = node.parentElement; } return parts.join(" > "); };
      const measurements = (window as unknown as { __webops: { lcp: number | null; cls: number; lcpSrc: string } }).__webops;
      const images = Array.from(document.images).map(el => { const rect = el.getBoundingClientRect(); return { src: el.currentSrc || el.src, alt: el.hasAttribute("alt") ? el.alt : null, width: el.getAttribute("width"), height: el.getAttribute("height"), loading: el.loading, title: el.title, decoding: el.decoding, fetchpriority: el.fetchPriority, srcset: el.srcset, sizes: el.sizes, renderedWidth: rect.width, renderedHeight: rect.height, intrinsicWidth: el.naturalWidth, intrinsicHeight: el.naturalHeight, isLcp: el.currentSrc === measurements.lcpSrc, selector: selector(el), context: el.parentElement?.textContent?.trim().slice(0,1000), source: "rendered" }; });
      const backgrounds = Array.from(document.querySelectorAll("*")).slice(0, 20000).flatMap(el => {
        const values = [getComputedStyle(el).backgroundImage, getComputedStyle(el,"::before").backgroundImage, getComputedStyle(el,"::after").backgroundImage];
        return values.flatMap(value => [...value.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(m => ({ src: m[1], alt: null, width: null, height: null, loading: null, source: "rendered-css", selector: selector(el), renderedWidth: el.getBoundingClientRect().width, renderedHeight: el.getBoundingClientRect().height })));
      });
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const resources = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).map(r => ({ url: r.name, type: r.initiatorType, initiator: r.initiatorType, startTime: r.startTime, duration: r.duration, transferSize: r.transferSize || null, decodedSize: r.decodedBodySize || null }));
      return { images: [...images, ...backgrounds], resources, measurements: { lcp: measurements.lcp, cls: measurements.cls, inp: null, fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null, ttfb: navigation ? navigation.responseStart - navigation.startTime : null, dns: navigation ? navigation.domainLookupEnd - navigation.domainLookupStart : null, tcp: navigation ? navigation.connectEnd - navigation.connectStart : null, tls: navigation?.secureConnectionStart ? navigation.connectEnd - navigation.secureConnectionStart : null } };
    });
    const evidence = buildEvidence({ requestedUrl, finalUrl: page.url(), depth, status: response?.status() || http.status, ok: response?.ok() ?? http.status < 400, redirected: page.url() !== requestedUrl, redirectChain: http.redirects, contentType: "text/html", contentLengthBytes: http.bytes.length, responseTimeMs: http.durationMs, headers: http.headers, body: await page.content() });
    evidence.rendered = true;
    evidence.images.push(...snapshot.images);
    evidence.resources = snapshot.resources.map(r => ({ ...r, thirdParty: !sameOrigin(r.url, page.url()) }));
    evidence.measurements = snapshot.measurements;
    evidence.limitations = ["Browser metrics describe this navigation and viewport; they are not field data. INP needs representative interactions or CrUX data. CLS uses the largest observed session window (one-second gap, maximum five seconds) during this bounded navigation.", "Cross-origin resource sizes may be unavailable without Timing-Allow-Origin."];
    if (config.accessibility) {
      try {
        const result = await new AxeBuilder({ page }).analyze();
        evidence.accessibilityIssues = result.violations.flatMap(v => v.nodes.map(n => ({ id: v.id, severity: v.impact === "critical" ? "high" : v.impact === "minor" ? "low" : "medium", description: v.description, selector: n.target.join(" "), evidence: n.html, recommendation: `${v.help}: ${n.failureSummary || v.helpUrl}` })));
      } catch { evidence.limitations.push("Rendered accessibility checks did not complete; markup checks remain available."); }
    }
    return evidence;
  } finally { clearTimeout(timer); await browser.close().catch(() => {}); }
}
