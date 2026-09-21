import { runPageSpeed } from "@/lib/pagespeed";
import { validateTarget, SsrfError } from "@/lib/ssrf";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, { bucket: "performance", limit: 6, maxBodyBytes: 8_000 });
  if (isGuardResponse(guard)) return guard;
  let body: { url?: string; strategy?: "mobile" | "desktop" };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const url = (body.url || "").trim();
  if (!url) return Response.json({ error: "A url is required." }, { status: 400 });
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    await validateTarget(withScheme);
    return Response.json(await runPageSpeed(withScheme, body.strategy === "desktop" ? "desktop" : "mobile"), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Performance check failed." }, { status: error instanceof SsrfError ? 400 : 500 });
  }
}
