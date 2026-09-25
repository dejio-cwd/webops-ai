import { rpc, isUuid } from "@/lib/database";
import { guard } from "@/lib/route-guard";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";
import { authorizeJob, getProgress } from "@/lib/pipeline/store";
// dispatchJob lazily imported below — see /api/jobs/route.ts for the rationale
// (avoids pulling the workflow/playwright/chromium/sharp graph into GET requests).
type Context={params:Promise<{id:string}>};
export const GET = guard("jobs/id.GET", async function GET(request:Request,context:Context) {
 const actor=await guardApiRequest(request,{bucket:"job-progress",limit:120,requireAuth:true});if(isGuardResponse(actor))return actor;if(!actor)return Response.json({error:"Sign in required."},{status:401});
 try{const {id}=await context.params;const job=isUuid(id)?await authorizeJob(id,actor.id):null;if(!job)return Response.json({error:"Audit not found."},{status:404});return Response.json({job,progress:await getProgress(id)},{headers:{"Cache-Control":"no-store"}});}catch(e){return Response.json({error:e instanceof Error?`Unable to load audit progress: ${e.message}`:"Unable to load audit progress."},{status:503});}
});
export const PATCH = guard("jobs/id.PATCH", async function PATCH(request:Request,context:Context) {
 const actor=await guardApiRequest(request,{bucket:"job-control",limit:30,requireAuth:true});if(isGuardResponse(actor))return actor;if(!actor)return Response.json({error:"Sign in required."},{status:401});
 try{const {id}=await context.params;const job=isUuid(id)?await authorizeJob(id,actor.id,true):null;if(!job)return Response.json({error:"Audit not found or access denied."},{status:404});const {action}=await request.json();if(!["pause","resume","cancel"].includes(action))return Response.json({error:"Invalid action."},{status:400});
 const status=await rpc<string>("control_audit_job",{p_job:id,p_action:action});
 if(action!=="pause" && ["QUEUED","RUNNING","CANCELLING"].includes(status)){const {dispatchJob}=await import("@/lib/pipeline/launch");await dispatchJob(id);}
 return Response.json({status});}catch(e){return Response.json({error:e instanceof Error?`Unable to update this audit: ${e.message}`:"Unable to update this audit."},{status:503});}
});
