import { start } from "workflow/api";
import { recommendationWorkflow } from "@/workflows/recommendations";
import { database,isUuid } from "@/lib/database";
import { guardApiRequest,isGuardResponse } from "@/lib/security/api-guard";
import { authorizeJob,saveRecords,recordKey } from "@/lib/pipeline/store";
import type { EvidenceRecord } from "@/lib/pipeline/types";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await guardApiRequest(request,{bucket:"ai-review-batch",limit:10,windowMs:300000,maxBodyBytes:16000,requireAuth:true});if(isGuardResponse(actor))return actor;if(!actor)return Response.json({error:"Sign in required."},{status:401});
 try{const {id}=await params;const job=isUuid(id)?await authorizeJob(id,actor.id,true):null;if(!job)return Response.json({error:"Audit access denied."},{status:403});
 const body=await request.json() as {kind:string;keys:string[];credentialId?:string;model?:string};
 if(!["ai_image","ai_page"].includes(body.kind) || !Array.isArray(body.keys) || !body.keys.length || body.keys.length>50 || body.keys.some(k=>!/^[a-f0-9]{40}$/.test(k)))return Response.json({error:"Select between 1 and 50 saved pages or images."},{status:400});
 const rows=await database<EvidenceRecord[]>(`audit_records?job_id=eq.${id}&kind=eq.${body.kind==="ai_image"?"images":"pages"}&key=in.(${body.keys.join(",")})`);
 if(!rows.length)return Response.json({error:"No matching evidence was found."},{status:404});
 const requestId=recordKey(crypto.randomUUID());await saveRecords(id,[{kind:"ai_requests",key:requestId,url:job.url,status:"queued",data:{type:body.kind,count:rows.length,createdAt:new Date().toISOString()}}]);
 const run=await start(recommendationWorkflow,[id,requestId,actor.id,body.kind,rows.map(r=>r.url),body.credentialId || "",body.model || ""]);
 return Response.json({requestId,runId:run.runId},{status:202});
 }catch{return Response.json({error:"Unable to queue AI analysis."},{status:503});}
}
