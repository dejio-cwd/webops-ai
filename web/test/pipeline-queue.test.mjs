import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";

test("durable queue enforces budgets, fences stale workers, retries, pauses, and cancels", async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key); create table public.projects(id uuid primary key);
    create table public.audit_runs(id uuid primary key,owner_id uuid,project_id uuid,url text,audit_id text,engine_version text,status text,completed_at timestamptz,summary jsonb,error_message text);
    insert into auth.users values('11111111-1111-4111-8111-111111111111');`);
  await db.exec(await readFile(new URL("../../supabase/migrations/20260925022622_durable_audit_pipeline.sql",import.meta.url),"utf8"));
  const job="22222222-2222-4222-8222-222222222222";
  const config={maxPages:2,maxDepth:2,concurrency:2,retries:1,maxImages:2,maxResources:2,maxSitemaps:2,maxPerformancePages:1,maxAiTasks:1};
  await db.query("select create_audit_job($1,$2,null,$3,$4)",[job,"11111111-1111-4111-8111-111111111111","https://example.com",config]);
  let claimed=(await db.query("select * from claim_audit_tasks($1)",[job])).rows;
  assert.equal(claimed.length,1);
  const first=claimed[0];
  await db.query("select commit_audit_task($1,$2,$3,$4)",[first.id,first.lease_token,[],[1,2,3].map(n=>({kind:"page",url:`https://example.com/${n}`,depth:1}))]);
  assert.equal((await db.query("select count(*)::int as n from crawl_tasks where kind='page'")).rows[0].n,2);
  claimed=(await db.query("select * from claim_audit_tasks($1)",[job])).rows;
  assert.equal(claimed.length,2);
  assert.equal((await db.query("select * from claim_audit_tasks($1)",[job])).rows.length,0);
  await db.query("update crawl_tasks set leased_until=now()-interval '1 second' where id=$1",[claimed[0].id]);
  const reclaimed=(await db.query("select * from claim_audit_tasks($1)",[job])).rows[0];
  assert.notEqual(reclaimed.lease_token,claimed[0].lease_token);
  const stale=await db.query("select commit_audit_task($1,$2,$3,$4) as ok",[claimed[0].id,claimed[0].lease_token,[{kind:"pages",key:"stale",url:"stale"}],[]]);
  assert.equal(stale.rows[0].ok,false);
  await db.query("select commit_audit_task($1,$2,$3,$4,$5)",[reclaimed.id,reclaimed.lease_token,[],[],"timeout"]);
  assert.equal((await db.query("select status from crawl_tasks where id=$1",[reclaimed.id])).rows[0].status,"failed");
  await db.query("select control_audit_job($1,'pause')",[job]);
  assert.equal((await db.query("select * from claim_audit_tasks($1)",[job])).rows.length,0);
  assert.equal((await db.query("select finalize_audit_job($1,'{}',true,false) as ok",[job])).rows[0].ok,false);
  await db.query("select control_audit_job($1,'resume')",[job]);
  await db.query("select control_audit_job($1,'cancel')",[job]);
  await db.query("select * from claim_audit_tasks($1)",[job]);
  assert.equal((await db.query("select status from audit_jobs where id=$1",[job])).rows[0].status,"CANCELLED");
  assert.equal((await db.query("select finalize_audit_job($1,'{}',true,false) as ok",[job])).rows[0].ok,false);
  assert.equal((await db.query("select count(*)::int n from audit_records where key='stale'")).rows[0].n,0);
  assert.equal((await db.query("select has_function_privilege('anon','public.claim_audit_tasks(uuid)','EXECUTE') as allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});
