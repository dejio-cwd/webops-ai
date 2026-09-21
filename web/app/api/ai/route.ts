// POST /api/ai -> evidence-grounded AI explanation / fix proposal.
// Body: {
//   mode: "explain" | "fix" | "summary",
//   opportunity?: Opportunity,        // for explain / fix
//   context?: { url, health, topFindings, crawl }, // for summary
//   provider?: string, model?: string,
//   credential?: { provider, apiKey?, baseUrl?, model? }  // BYOK, from AI Studio settings
// }
// The model is strictly instructed to use only the supplied evidence.

import { generateText, type Credential } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM = `You are a senior technical SEO and web-performance engineer inside the WebOps AI platform.
Rules:
- Use ONLY the evidence provided by the tool. Never invent metrics, URLs, or numbers.
- Be concrete and actionable. Prefer specific code/config over generic advice.
- If the evidence is insufficient to be certain, say so plainly.
- Keep responses tight and skimmable. Use short sections and code blocks where useful.`;

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const mode = body.mode || "explain";
  let user = "";

  if (mode === "summary" && body.context) {
    const c = body.context;
    user = `Write a concise executive summary of this website audit for a non-technical stakeholder.
Evidence (JSON):
${JSON.stringify(c).slice(0, 6000)}

Cover: overall health, the 3 most important problems, and the expected business impact of fixing them. ~180 words.`;
  } else if (body.opportunity) {
    const o = body.opportunity;
    const base = `Issue: ${o.title}
Category: ${o.category}
Severity: ${o.severity}
Affected pages: ${o.affectedCount}
Why it matters: ${o.why}
Baseline recommendation: ${o.recommendation}
Sample evidence:
${(o.sampleEvidence || []).join("\n") || "(none captured)"}
Example affected URLs:
${(o.affectedUrls || []).slice(0, 6).join("\n")}`;

    user =
      mode === "fix"
        ? `${base}

Produce a step-by-step remediation playbook: (1) root cause, (2) exact fix with a concrete code/config example, (3) how to validate the fix, (4) rollback note. Ground everything in the evidence above.`
        : `${base}

Explain this issue clearly: what it means, why these specific pages triggered it, the concrete impact, and the single highest-leverage next step. Ground everything in the evidence above.`;
  } else {
    return Response.json({ error: "Provide an 'opportunity' or a summary 'context'." }, { status: 400 });
  }

  try {
    const credential: Credential | undefined = body.credential
      ? {
          provider: body.credential.provider,
          apiKey: body.credential.apiKey,
          baseUrl: body.credential.baseUrl,
          model: body.credential.model,
        }
      : undefined;
    const result = await generateText({
      system: SYSTEM,
      user,
      provider: body.provider,
      model: body.model,
      credential,
      maxTokens: mode === "summary" ? 500 : 900,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "AI request failed." },
      { status: 502 },
    );
  }
}
