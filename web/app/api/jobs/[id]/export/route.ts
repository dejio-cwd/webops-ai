import { PassThrough,Readable } from "node:stream";
import ExcelJS from "exceljs";
import { isUuid } from "@/lib/database";
import { guardApiRequest,isGuardResponse } from "@/lib/security/api-guard";
import { authorizeJob,recordBatches } from "@/lib/pipeline/store";
import type { EvidenceRecord } from "@/lib/pipeline/types";
export const runtime="nodejs";export const maxDuration=300;
const kinds=["pages","findings","images","image_usage","links","link_targets","resources","resource_usage","performance","structured_data","sitemap_urls","ai_analyses","opportunities","reports"];
const scalar=(v:unknown)=>v===null||v===undefined?"":typeof v==="object"?JSON.stringify(v):String(v);
const safe=(v:unknown)=>{const s=scalar(v);return /^[=+@\-\t\r]/.test(s)?`'${s}`:s;};
function columns(row:EvidenceRecord<Record<string,unknown>>){return {URL:row.url,Source:row.source_url || "",Title:row.title || "",Status:row.status || "",...row.data};}
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await guardApiRequest(request,{bucket:"audit-export",limit:15,requireAuth:true});if(isGuardResponse(actor))return actor;if(!actor)return Response.json({error:"Sign in required."},{status:401});
 try{const {id}=await params;const job=isUuid(id)?await authorizeJob(id,actor.id):null;if(!job)return Response.json({error:"Audit not found."},{status:404});const format=new URL(request.url).searchParams.get("format") || "json";
 if(!["json","csv","xlsx"].includes(format))return Response.json({error:"Choose JSON, CSV, or Excel."},{status:400});
 const filename=`webops-${new URL(job.url).hostname}-${id}.${format}`;
 if(format==="xlsx"){
  const stream=new PassThrough();const workbook=new ExcelJS.stream.xlsx.WorkbookWriter({stream,useStyles:false,useSharedStrings:false});
  const generate=async()=>{const summary=workbook.addWorksheet("Summary");summary.addRow(["Website",job.url]).commit();summary.addRow(["Status",job.status]).commit();summary.addRow(["Configuration",JSON.stringify(job.config)]).commit();summary.addRow(["Summary",JSON.stringify(job.summary)]).commit();summary.commit();
   for(const kind of kinds){const sheet=workbook.addWorksheet(kind.slice(0,31));let headers:string[]|undefined;for await(const batch of recordBatches<Record<string,unknown>>(id,kind))for(const row of batch){const values=columns(row);if(!headers){headers=Object.keys(values);sheet.addRow(headers).commit();}sheet.addRow(headers.map(key=>safe(values[key as keyof typeof values]).slice(0,32700))).commit();}sheet.commit();}await workbook.commit();};
  void generate().catch(error=>stream.destroy(error));
  return new Response(Readable.toWeb(stream) as ReadableStream,{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="${filename}"`,"Cache-Control":"no-store"}});
 }
 const encoder=new TextEncoder();
 const body=new ReadableStream({async start(controller){try{if(format==="json"){controller.enqueue(encoder.encode(JSON.stringify({job:{id:job.id,url:job.url,status:job.status,config:job.config,summary:job.summary}}).slice(0,-1)+',"records":['));let first=true;for(const kind of kinds)for await(const batch of recordBatches(id,kind))for(const row of batch){controller.enqueue(encoder.encode(`${first?"":","}${JSON.stringify(row)}`));first=false;}controller.enqueue(encoder.encode("]}"));}else{controller.enqueue(encoder.encode("\ufeffSeverity,Category,Title,URL,Element,Evidence,Recommendation,Status\r\n"));for await(const batch of recordBatches<Record<string,unknown>>(id,"findings"))for(const row of batch){const f=row.data;const line=[row.severity,row.category,row.title,row.url,f.element,f.evidence,f.recommendation,row.status].map(v=>`"${safe(v).replaceAll('"','""')}"`).join(",");controller.enqueue(encoder.encode(`${line}\r\n`));}}controller.close();}catch(e){controller.error(e);}}});
 return new Response(body,{headers:{"Content-Type":format==="json"?"application/json":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${filename}"`,"Cache-Control":"no-store"}});
 }catch{return Response.json({error:"Unable to export this audit."},{status:503});}
}
