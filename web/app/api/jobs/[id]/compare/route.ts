import { isUuid } from "@/lib/database";
import { guard } from "@/lib/route-guard";
import { guardApiRequest,isGuardResponse } from "@/lib/security/api-guard";
import { authorizeJob,recordBatches } from "@/lib/pipeline/store";
import type { PageEvidence,Finding } from "@/lib/types";
export const GET = guard("jobs/id/compare.GET", async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
 const actor=await guardApiRequest(request,{bucket:"audit-compare",limit:20,requireAuth:true});if(isGuardResponse(actor))return actor;if(!actor)return Response.json({error:"Sign in required."},{status:401});
 try{const {id}=await params;const beforeId=new URL(request.url).searchParams.get("before") || "";if(!isUuid(id)||!isUuid(beforeId))return Response.json({error:"Choose two audits."},{status:400});
 const [before,after]=await Promise.all([authorizeJob(beforeId,actor.id),authorizeJob(id,actor.id)]);if(!before||!after||before.project_id!==after.project_id)return Response.json({error:"Choose accessible audits from the same project."},{status:403});
 const oldPages=new Map<string,PageEvidence>(),newPages=new Map<string,PageEvidence>();
 for await(const batch of recordBatches<PageEvidence>(beforeId,"pages"))for(const r of batch)oldPages.set(r.url,r.data);
 for await(const batch of recordBatches<PageEvidence>(id,"pages"))for(const r of batch)newPages.set(r.url,r.data);
 const oldIssues=new Map<string,Finding>(),newIssues=new Map<string,Finding>();
 for await(const batch of recordBatches<Finding>(beforeId,"findings"))for(const r of batch)oldIssues.set(r.key,r.data);
 for await(const batch of recordBatches<Finding>(id,"findings"))for(const r of batch)newIssues.set(r.key,r.data);
 const complete=after.status==="COMPLETED" && !(after.summary.coverage as {partial?:boolean})?.partial;
 const resolved:Finding[]=[],unverified:Finding[]=[];
 for(const [key,f]of oldIssues)if(!newIssues.has(key)){const page=newPages.get(f.url) || [...newPages.values()].find(p=>p.finalUrl===f.url);(complete && page?.ok?resolved:unverified).push(f);}
 const changed:Record<string,unknown>[]=[];
 for(const [url,page]of newPages){const old=oldPages.get(url);if(!old)continue;const fields:Record<string,unknown>={};for(const field of ["title","metaDescription","canonical","indexable","contentHash","images","links","measurements"] as const)if(JSON.stringify(old[field])!==JSON.stringify(page[field]))fields[field]={before:old[field],after:page[field]};if(Object.keys(fields).length)changed.push({url,fields});}
 return Response.json({before:before.id,after:after.id,completeCoverage:complete,newPages:[...newPages.keys()].filter(u=>!oldPages.has(u)).slice(0,1000),notObserved:[...oldPages.keys()].filter(u=>!newPages.has(u)).slice(0,1000),changed:changed.slice(0,500),newFindings:[...newIssues].filter(([key])=>!oldIssues.has(key)).map(([,f])=>f).slice(0,1000),resolvedFindings:resolved.slice(0,1000),unverifiedFindings:unverified.slice(0,1000),counts:{changed:changed.length,resolved:resolved.length,unverified:unverified.length},limitation:"Unobserved URLs are not assumed deleted. Resolution requires successful follow-up coverage and a completed, untruncated audit. Detail lists are capped at 1,000 findings/URLs and 500 changed pages; exports retain source evidence."});
 }catch{return Response.json({error:"Unable to compare saved evidence."},{status:503});}
});
