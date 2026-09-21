// POST /api/performance -> real Lighthouse + Core Web Vitals via Google PSI.
// Body: { url: string, strategy?: "mobile" | "desktop" }

import { runPageSpeed } from "@/lib/pagespeed";
import { validateTarget, SsrfError } from "@/lib/ssrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: { url?: string; strategy?: "mobile" | "desktop" };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const url = (body.url || "").trim();
  if (!url) return Response.json({ error: "A url is required." }, { status: 400 });
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const strategy = body.strategy === "desktop" ? "desktop" : "mobile";

  try {
    await validateTarget(withScheme); // block SSRF before handing the URL to Google
    const result = await runPageSpeed(withScheme, strategy);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const status = err instanceof SsrfError ? 400 : 500;
    return Response.json(
      { error: err instanceof Error ? err.message : "Performance check failed." },
      { status },
    );
  }
}
