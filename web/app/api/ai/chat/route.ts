import { generateText, type ChatMessage } from "@/lib/ai";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";
import { credentialFromRequest } from "@/lib/security/ai-credential";
import { validateAiCredentialEndpoint } from "@/lib/security/outbound";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const maxDuration = 60;
const SYSTEM = `You are Mule, the WebOps AI assistant. Be direct, concrete, and skimmable. Use supplied audit evidence when present, never invent measurements, and state when evidence is insufficient.`;
export async function POST(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "ai-chat", limit: 12, maxBodyBytes: 64_000 }); if (isGuardResponse(actor)) return actor;
  let body: any; try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const messages: ChatMessage[] = Array.isArray(body.messages) ? body.messages.filter((message: any) => message && typeof message.content === "string" && ["user", "assistant"].includes(message.role)).slice(-24) : [];
  if (!messages.length) return Response.json({ error: "At least one message is required." }, { status: 400 });
  try { const credential = await credentialFromRequest(actor, body); await validateAiCredentialEndpoint(credential); const auditEvidence = body.auditContext ? `\n\nCurrent audit evidence (JSON, truncated):\n${JSON.stringify(body.auditContext).slice(0, 8_000)}` : ""; return Response.json(await generateText({ system: SYSTEM + auditEvidence, messages, credential, provider: body.provider, model: body.model, maxTokens: 1_400, temperature: 0.4 }), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Chat request failed." }, { status: 502 }); }
}
