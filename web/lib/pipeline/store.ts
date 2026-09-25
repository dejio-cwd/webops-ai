import { createHash } from "node:crypto";
import { database, databaseConfig, rpc } from "../database";
import { projectAccess, canManageProject } from "../security/project-access";
import type { AuditJob, EvidenceRecord, Progress } from "./types";

export const recordKey = (...parts: string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 40);
export async function getJob(id: string) { return (await database<AuditJob[]>(`audit_jobs?id=eq.${encodeURIComponent(id)}&limit=1`))[0] || null; }
export async function authorizeJob(id: string, actor: string, write = false) {
  const job = await getJob(id);
  if (!job) return null;
  if (job.project_id) {
    const access = await projectAccess(databaseConfig(), job.project_id, actor);
    if (!access || (write && !canManageProject(access.role))) return null;
  } else if (job.owner_id !== actor) return null;
  return job;
}
export const getProgress = (id: string) => rpc<Progress>("audit_job_progress", { p_job: id });
export async function updateJob(id: string, patch: Partial<AuditJob>) { await database(`audit_jobs?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) }); }
export async function records<T>(job: string, kind: string, offset = 0, limit = 100): Promise<EvidenceRecord<T>[]> {
  return database(`audit_records?job_id=eq.${job}&kind=eq.${kind}&order=key&offset=${offset}&limit=${limit}`);
}
export async function* recordBatches<T>(job: string, kind: string) {
  for (let offset = 0; ; offset += 100) {
    const batch = await records<T>(job, kind, offset);
    if (!batch.length) break;
    yield batch;
    if (batch.length < 100) break;
  }
}
export async function saveRecords(job: string, rows: EvidenceRecord[]) {
  for (let i = 0; i < rows.length; i += 100) await database("audit_records?on_conflict=job_id,kind,key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(rows.slice(i, i + 100).map(r => ({ ...r, job_id: job }))) });
}
