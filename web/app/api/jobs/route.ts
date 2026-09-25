import { database, databaseConfig, isUuid } from "@/lib/database";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";
import { projectAccess } from "@/lib/security/project-access";
import { launchAudit } from "@/lib/pipeline/launch";
import type { AuditConfig } from "@/lib/pipeline/config";
export const runtime="nodejs";export const maxDuration=60;
export async function GET(request:Request){
 const actor=await guardApiRequest(request,{bucket:"jobs-read",limit:120,requireAuth:true});if(isGuardResponse(actor))return actor;if(!actor)return Response.json({error:"Sign in required."},{status:401});
 try{
  const params=new URL(request.url).searchParams;const project=params.get("projectId");
  if(project && (!isUuid(project) || !await projectAccess(databaseConfig(),project,actor.id)))return Response.json({error:"Project not found."},{status:404});
  const offset=Math.max(0,Number(params.get("offset"))||0);
  const jobs=await database(`audit_jobs?${project?`project_id=eq.${project}`:`owner_id=eq.${actor.id}`}&order=created_at.desc&limit=30&offset=${offset}`);
  return Response.json({jobs},{headers:{"Cache-Control":"no-store"}});
 }catch(e){const m=e instanceof Error?e.message:String(e);const gap=/PGRST202|does not exist|audit_jobs/i.test(m);return Response.json({error:gap?"Audit pipeline migration is not installed. Apply supabase/migrations/20260925022622_durable_audit_pipeline.sql.":`Unable to load audit jobs: ${m}`},{status:503});}
}
export async function POST(request:Request){
 const actor=await guardApiRequest(request,{bucket:"jobs-create",limit:10,windowMs:300000,maxBodyBytes:32000,requireAuth:true});if(isGuardResponse(actor))return actor;if(!actor)return Response.json({error:"Sign in required."},{status:401});
 try{const body=await request.json() as {url?:string;projectId?:string;config?:Partial<AuditConfig>};const id=await launchAudit(actor.id,body);return Response.json({jobId:id,url:`/audits?jobId=${id}`},{status:202});}
 catch(e){return Response.json({error:e instanceof Error?e.message:"Unable to queue the audit."},{status:400});}
}
