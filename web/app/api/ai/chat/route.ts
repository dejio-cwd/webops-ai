// POST /api/ai/chat -> "Mule": a general-purpose LLM chat surface, routed
// through whichever provider/model/connection the user picked in AI Studio.
// Unlike /api/ai (which is strictly evidence-grounded for opportunities), this
// is an open conversation — optionally anchored to the current audit so the
// user can ask free-form questions about their site.
//
// Body: {
//   messages: { role: "user" | "assistant", content: string }[],
//   credential?: { provider, apiKey?, baseUrl?, model? },
//   auditContext?: object   // optional trimmed audit summary for grounding
// }

import { generateText, type Credential, type ChatMessage } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BASE_SYSTEM = `You are Mule, the built-in AI assistant inside the WebOps AI platform.
You help with website audits, SEO, performance, accessibility, and general web-ops questions.
Be direct, concrete, and skimmable. Use code blocks for code/config. If the user asks about
their current audit and audit evidence is supplied below, ground your answer in it and say
plainly when the evidence doesn't cover something. Otherwise answer as a knowledgeable engineer.`;

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages: ChatMessage[] = Array.isArray(body.messages)
    ? body.messages
        .filter((m: any) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
        .slice(-24)
    : [];
  if (!messages.length) {
    return Response.json({ error: "At least one message is required." }, { status: 400 });
  }

  let system = BASE_SYSTEM;
  if (body.auditContext) {
    system += `\n\nCurrent audit evidence (JSON, may be truncated):\n${JSON.stringify(body.auditContext).slice(0, 8000)}`;
  }

  const credential: Credential | undefined = body.credential
    ? {
        provider: body.credential.provider,
        apiKey: body.credential.apiKey,
        baseUrl: body.credential.baseUrl,
        model: body.credential.model,
      }
    : undefined;

  try {
    const result = await generateText({
      system,
      messages,
      credential,
      provider: body.provider,
      model: body.model,
      maxTokens: 1400,
      temperature: 0.4,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Chat request failed." },
      { status: 502 },
    );
  }
}
