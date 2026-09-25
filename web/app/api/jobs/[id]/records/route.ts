import { database, isUuid } from "@/lib/database";
import { guard } from "@/lib/route-guard";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";
import { authorizeJob } from "@/lib/pipeline/store";
import type { EvidenceRecord } from "@/lib/pipeline/types";
const kinds=new Set(["pages","links","link_targets","images","image_usage","resources","resource_usage","findings","opportunities","structured_data","sitemaps","sitemap_urls","policy","restrictions","performance","ai_analyses","ai_requests","reports"]);
type Context={params:Promise<{id:string}>};
export const GET = guard("jobs/id/records.GET", async function GET(request:Request,context:Context) {
 const actor=await guardApiRequest(request,{bucket:"audit-records",limit:180,requireAuth:true});if(isGuardResponse(actor))return actor;if(!actor)return Response.json({error:"Sign in required."},{status:401});
 try{
  const {id}=await context.params;const job=isUuid(id)?await authorizeJob(id,actor.id):null;if(!job)return Response.json({error:"Audit not found."},{status:404});
  const params=new URL(request.url).searchParams;const kind=params.get("kind") || "pages";if(!kinds.has(kind) && kind!=="tasks")return Response.json({error:"Unknown evidence type."},{status:400});
  const offset=Math.max(0,Math.floor(Number(params.get("offset"))||0));const limit=Math.min(100,Math.max(1,Number(params.get("limit"))||50));
  if(kind==="tasks"){const rows=await database<Array<{id:string;kind:string;url:string;status:string;attempts:number;error:string|null}>>(`crawl_tasks?job_id=eq.${id}&select=id,kind,url,status,attempts,error&order=created_at&offset=${offset}&limit=${limit+1}`);return Response.json({records:rows.slice(0,limit).map(row=>({key:row.id,kind:"tasks",url:row.url,status:row.status,title:row.kind,data:row})),hasMore:rows.length>limit,offset});}
  let path=`audit_records?job_id=eq.${id}&kind=eq.${kind}&order=key&offset=${offset}&limit=${limit+1}`;
  for(const field of ["category","severity","status","key","source_url","url"]){const value=params.get(field);if(value)path+=`&${field}=eq.${encodeURIComponent(value)}`;}
  const q=params.get("q")?.replace(/[*,()]/g,"");if(q)path+=`&url=ilike.*${encodeURIComponent(q)}*`;
  const rows=await database<EvidenceRecord[]>(path);
  return Response.json({records:rows.slice(0,limit),hasMore:rows.length>limit,offset},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return Response.json({error:e instanceof Error?`Unable to load evidence: ${e.message}`:"Unable to load evidence."},{status:503});}
});
export const PATCH = guard("jobs/id/records.PATCH", async function PATCH(request:Request,context:Context) {
 const actor=await guardApiRequest(request,{bucket:"record-review",limit:60,requireAuth:true});if(isGuardResponse(actor))return actor;if(!actor)return Response.json({error:"Sign in required."},{status:401});
 try{const {id}=await context.params;if(!isUuid(id) || !await authorizeJob(id,actor.id,true))return Response.json({error:"Audit access denied."},{status:403});
 const body=await request.json() as {kind:string;keys:string[];status:string;editedAlt?:string};
 if(!["findings","ai_analyses"].includes(body.kind) || !["open","ignored","resolved","accepted","rejected"].includes(body.status) || !Array.isArray(body.keys) || !body.keys.length || body.keys.length>100 || body.keys.some(k=>!/^[a-f0-9]{40}$/.test(k)))return Response.json({error:"Invalid review request."},{status:400});
 const rows=await database<EvidenceRecord<Record<string,unknown>>[]>(`audit_records?job_id=eq.${id}&kind=eq.${body.kind}&key=in.(${body.keys.join(",")})`);
 for(const row of rows){const data={...row.data,review:body.status,reviewedAt:new Date().toISOString(),reviewedBy:actor.id,...(typeof body.editedAlt==="string"?{editedAlt:body.editedAlt.slice(0,2000)}:{})};await database(`audit_records?job_id=eq.${id}&kind=eq.${body.kind}&key=eq.${row.key}`,{method:"PATCH",body:JSON.stringify({status:body.status,data})});}
 return Response.json({updated:rows.length});}catch(e){return Response.json({error:e instanceof Error?`Unable to save review: ${e.message}`:"Unable to save review."},{status:503});}
});
