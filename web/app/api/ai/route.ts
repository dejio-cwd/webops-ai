import { generateText } from "@/lib/ai";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";
import { credentialFromRequest } from "@/lib/security/ai-credential";
import { validateAiCredentialEndpoint } from "@/lib/security/outbound";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const maxDuration = 60;
const SYSTEM = `You are a senior technical SEO and web-performance engineer inside WebOps AI. Use only supplied evidence. Never invent metrics, URLs, or numbers. Give concrete, actionable advice and state when evidence is insufficient.`;

export async function POST(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "ai-generate", limit: 12, maxBodyBytes: 64_000 }); if (isGuardResponse(actor)) return actor;
  let body: any; try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const mode = body.mode || "explain"; let user = "";
  if (mode === "summary" && body.context) user = `Write a concise executive audit summary grounded only in this evidence:\n${JSON.stringify(body.context).slice(0, 6_000)}\nCover overall health, three priorities, and likely business impact in about 180 words.`;
  else if (body.opportunity) { const opportunity = body.opportunity; const evidence = `Issue: ${opportunity.title}\nCategory: ${opportunity.category}\nSeverity: ${opportunity.severity}\nAffected pages: ${opportunity.affectedCount}\nWhy: ${opportunity.why}\nRecommendation: ${opportunity.recommendation}\nEvidence: ${(opportunity.sampleEvidence || []).join("\n") || "none"}\nURLs: ${(opportunity.affectedUrls || []).slice(0, 6).join("\n")}`; user = mode === "fix" ? `${evidence}\nProduce a root-cause analysis, exact remediation steps, code/config example, validation procedure, and rollback note.` : `${evidence}\nExplain what this means, why these pages triggered it, its impact, and the highest-leverage next step.`; }
  else return Response.json({ error: "Provide an opportunity or summary context." }, { status: 400 });
  try { const credential = await credentialFromRequest(actor, body); await validateAiCredentialEndpoint(credential); return Response.json(await generateText({ system: SYSTEM, user, credential, provider: body.provider, model: body.model, maxTokens: mode === "summary" ? 500 : 900 }), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "AI request failed." }, { status: 502 }); }
}
