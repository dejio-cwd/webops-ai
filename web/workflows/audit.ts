import { sleep } from "workflow";
import { tickAudit, failAudit } from "@/lib/pipeline/worker";

export async function auditWorkflow(jobId: string) {
  "use workflow";
  try {
    for (;;) {
      const state = await advance(jobId);
      if (state.finished) return state;
      if (state.delayMs > 0) await sleep(state.delayMs);
    }
  } catch {
    await markFailed(jobId);
    return { finished: true, status: "FAILED" };
  }
}
async function advance(jobId: string) { "use step"; return tickAudit(jobId); }
advance.maxRetries = 5;
async function markFailed(jobId: string) { "use step"; await failAudit(jobId, "The worker stopped after repeated failures. Partial evidence is saved; resume to retry."); }
