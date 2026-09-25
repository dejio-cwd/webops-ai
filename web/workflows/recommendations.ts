import { getJob, saveRecords, recordKey } from "@/lib/pipeline/store";
import { analyzeTask } from "@/lib/pipeline/ai";

export async function recommendationWorkflow(jobId:string,requestId:string,actorId:string,kind:string,targets:string[],credentialId:string,model:string){
 "use workflow";
 for(const url of targets)await analyzeOne(jobId,requestId,actorId,kind,url,credentialId,model);
 await finish(jobId,requestId);
}
async function analyzeOne(jobId:string,requestId:string,actorId:string,kind:string,url:string,credentialId:string,model:string){
 "use step";
 const job=await getJob(jobId);if(!job)return;
 job.owner_id=actorId;job.config={...job.config,credentialId:credentialId || job.config.credentialId,model:model || job.config.model};
 const id=recordKey(requestId,url);
 try{const record=await analyzeTask(job,{id,job_id:jobId,kind,url,depth:0,source_url:null,payload:{},attempts:1,lease_token:"",status:"leased"});await saveRecords(jobId,[record]);}
 catch(e){await saveRecords(jobId,[{kind:"ai_analyses",key:recordKey(id),url,title:"AI analysis could not complete",status:"failed",data:{type:kind,error:e instanceof Error?e.message:"AI provider unavailable",requestId}}]);}
}
async function finish(jobId:string,requestId:string){"use step";await saveRecords(jobId,[{kind:"ai_requests",key:requestId,url:"",status:"completed",data:{completedAt:new Date().toISOString()}}]);}
