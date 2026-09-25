import { rpc } from "../database";
import { getJob, getProgress, updateJob } from "./store";
import { processTask } from "./tasks";
import { finalizeAudit } from "./analysis";
import type { CrawlTask } from "./types";

export async function tickAudit(jobId: string) {
  let job = await getJob(jobId);
  if (!job) return { finished:true,status:"FAILED",delayMs:0 };
  if (["PAUSED","CANCELLED","COMPLETED","FAILED"].includes(job.status)) return { finished:true,status:job.status,delayMs:0 };
  const tasks=await rpc<CrawlTask[]>("claim_audit_tasks",{p_job:jobId});
  job=(await getJob(jobId))!;
  if(job.status==="CANCELLED")return {finished:true,status:job.status,delayMs:0};
  if(tasks.length){
    await updateJob(jobId,{stage:tasks[0].kind.startsWith("ai_")?"generating AI analysis":tasks[0].kind==="page"?"crawling":tasks[0].kind});
    await Promise.all(tasks.map(async task=>{
      let output;
      try { output=await processTask(job!,task); }
      catch(error){ await rpc("commit_audit_task",{p_task:task.id,p_token:task.lease_token,p_records:[],p_tasks:[],p_error:error instanceof Error?error.message.slice(0,1000):"Task failed"});return; }
      // Persistence errors propagate to Workflow retry. Never mark unsaved evidence done.
      await rpc("commit_audit_task",{p_task:task.id,p_token:task.lease_token,p_records:output.records,p_tasks:output.tasks,p_metadata:output.metadata || {}});
    }));
  }
  const progress=await getProgress(jobId);
  const current=await getJob(jobId);
  if(!current || ["PAUSED","CANCELLED","COMPLETED","FAILED"].includes(current.status))return {finished:true,status:current?.status || "FAILED",delayMs:0};
  if(current.status==="CANCELLING")return {finished:false,status:current.status,delayMs:0};
  if(!progress.pending && !progress.running){await finalizeAudit(current);return {finished:true,status:(await getJob(jobId))!.status,delayMs:0};}
  const delay = Math.max(current.config.delayMs,(current.robots?.crawlDelay || 0)*1000);
  return {finished:false,status:current.status,delayMs:tasks.length?delay:Math.max(1000,Math.min(10000,progress.nextAttempt?Date.parse(progress.nextAttempt)-Date.now():5000))};
}
export async function failAudit(jobId:string,error:string){await updateJob(jobId,{status:"FAILED",error});}
