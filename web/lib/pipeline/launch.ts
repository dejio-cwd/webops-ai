import { start } from "workflow/api";
import { auditWorkflow } from "@/workflows/audit";
import { database, databaseConfig, rpc } from "../database";
import { validateTarget } from "../ssrf";
import { projectAccess, canManageProject } from "../security/project-access";
import { normalizeConfig, type AuditConfig } from "./config";
import { updateJob } from "./store";

export async function dispatchJob(id:string){
  const run=await start(auditWorkflow,[id]);
  await updateJob(id,{workflow_run_id:run.runId});
  return run.runId;
}
export async function launchAudit(actor:string,body:{url?:string;projectId?:string;config?:Partial<AuditConfig>}, monitoring?:{id:string;claim:string}){
  let raw=typeof body.url==="string"?body.url.trim():"";
  if(!raw)throw new Error("Enter a website URL.");
  if(!/^https?:\/\//i.test(raw))raw=`https://${raw}`;
  const url=await validateTarget(raw);
  url.hash="";
  if(body.projectId){
    const access=await projectAccess(databaseConfig(),body.projectId,actor);
    if(!access || !canManageProject(access.role))throw new Error("You do not have permission to start audits in this project.");
    const project=(await database<{domain:string}[]>(`projects?id=eq.${body.projectId}&select=domain&limit=1`))[0];
    const domain=project.domain.toLowerCase().replace(/^www\./,"");const host=url.hostname.toLowerCase().replace(/^www\./,"");
    if(host!==domain && !host.endsWith(`.${domain}`))throw new Error("Audit URL must match the selected project domain.");
  }
  const config=normalizeConfig(body.config);const id=crypto.randomUUID();
  await rpc("create_audit_job",{p_id:id,p_owner:actor,p_project:body.projectId || null,p_url:url.href,p_config:config});
  if(monitoring) await updateJob(id,{summary:{source:"scheduled_monitoring",monitorId:monitoring.id,monitorClaim:monitoring.claim}});
  try { await dispatchJob(id); }
  catch { await updateJob(id,{error:"The job was saved but dispatch could not be confirmed. Resume to retry; worker leases prevent duplicate processing."}); }
  return id;
}
