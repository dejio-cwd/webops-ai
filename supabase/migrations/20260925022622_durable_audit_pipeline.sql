-- Additive migration against the inspected production schema. Existing audit
-- results and statuses remain readable by the previous application version.
begin;
create table public.audit_jobs (
  id uuid primary key references public.audit_runs(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  project_id uuid references public.projects(id) on delete set null,
  url text not null,
  config jsonb not null,
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','PAUSED','CANCELLING','CANCELLED','COMPLETED','FAILED')),
  stage text not null default 'discovery',
  workflow_run_id text,
  robots jsonb,
  summary jsonb not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index audit_jobs_project_created on public.audit_jobs(project_id, created_at desc);
create index audit_jobs_owner_created on public.audit_jobs(owner_id, created_at desc);

create table public.crawl_tasks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.audit_jobs(id) on delete cascade,
  kind text not null,
  url text not null,
  url_key text generated always as (md5(url)) stored,
  depth integer not null default 0,
  priority integer not null default 10,
  source_url text,
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending','leased','done','failed','skipped')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  leased_until timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique(job_id, kind, url_key)
);
create index crawl_tasks_claim on public.crawl_tasks(job_id, priority, available_at) where status in ('pending','leased');
create index crawl_tasks_progress on public.crawl_tasks(job_id, kind, status);

-- Each page, link occurrence, image asset/usage, resource, finding, AI output,
-- and report has an independently addressable row, never one crawl-sized blob.
create table public.audit_records (
  job_id uuid not null references public.audit_jobs(id) on delete cascade,
  kind text not null,
  key text not null,
  url text not null default '',
  source_url text,
  title text not null default '',
  category text,
  severity text,
  status text not null default 'open',
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(job_id, kind, key)
);
create index audit_records_filter on public.audit_records(job_id, kind, category, severity, status);
create index audit_records_url on public.audit_records(job_id, kind, md5(url));
create index audit_records_source on public.audit_records(job_id, kind, md5(source_url));

alter table public.audit_jobs enable row level security;
alter table public.crawl_tasks enable row level security;
alter table public.audit_records enable row level security;
revoke all on public.audit_jobs, public.crawl_tasks, public.audit_records from public, anon, authenticated;
grant all on public.audit_jobs, public.crawl_tasks, public.audit_records to service_role;

create function public.enqueue_audit_tasks(p_job uuid, p_tasks jsonb) returns integer
language plpgsql security invoker set search_path = public as $$
declare j public.audit_jobs; t jsonb; cap integer; n integer; inserted integer; total integer := 0;
begin
  select * into j from public.audit_jobs where id=p_job for update;
  if j.status not in ('QUEUED','RUNNING','PAUSED') then return 0; end if;
  for t in select value from jsonb_array_elements(p_tasks) loop
    cap := case t->>'kind'
      when 'page' then (j.config->>'maxPages')::integer
      when 'image' then (j.config->>'maxImages')::integer
      when 'resource' then (j.config->>'maxResources')::integer
      when 'link' then (j.config->>'maxResources')::integer
      when 'sitemap' then (j.config->>'maxSitemaps')::integer
      when 'performance' then (j.config->>'maxPerformancePages')::integer
      when 'ai_image' then (j.config->>'maxAiTasks')::integer
      when 'ai_page' then (j.config->>'maxAiTasks')::integer
      else 1 end;
    if t->>'kind' = 'page' and coalesce((t->>'depth')::integer,0) > (j.config->>'maxDepth')::integer then continue; end if;
    select count(*) into n from public.crawl_tasks where job_id=p_job and (case when t->>'kind' in ('ai_image','ai_page') then kind in ('ai_image','ai_page') else kind=t->>'kind' end);
    if n >= cap then
      if not exists(select 1 from public.crawl_tasks where job_id=p_job and kind=t->>'kind' and url_key=md5(t->>'url')) then
        update public.audit_jobs set summary=jsonb_set(summary, '{limited}', coalesce(summary->'limited','{}') || jsonb_build_object(t->>'kind',true)) where id=p_job;
      end if;
      continue;
    end if;
    insert into public.crawl_tasks(job_id,kind,url,depth,source_url,payload,priority)
    values(p_job,t->>'kind',t->>'url',coalesce((t->>'depth')::integer,0),t->>'source_url',coalesce(t->'payload','{}'),coalesce((t->>'priority')::integer,10))
    on conflict(job_id,kind,url_key) do nothing;
    get diagnostics inserted = row_count; total := total + inserted;
  end loop;
  return total;
end $$;

create function public.create_audit_job(p_id uuid, p_owner uuid, p_project uuid, p_url text, p_config jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
begin
  insert into public.audit_runs(id,owner_id,project_id,url,audit_id,engine_version,status)
  values(p_id,p_owner,p_project,p_url,p_id::text,'2.0.0','running');
  insert into public.audit_jobs(id,owner_id,project_id,url,config) values(p_id,p_owner,p_project,p_url,p_config);
  perform public.enqueue_audit_tasks(p_id,jsonb_build_array(jsonb_build_object('kind','robots','url',p_url,'priority',0)));
  return p_id;
end $$;

create function public.claim_audit_tasks(p_job uuid) returns setof public.crawl_tasks
language plpgsql security invoker set search_path = public as $$
declare j public.audit_jobs; slots integer;
begin
  select * into j from public.audit_jobs where id=p_job for update;
  if j.status='CANCELLING' then
    update public.audit_jobs set status='CANCELLED', completed_at=now(), updated_at=now() where id=p_job;
    update public.crawl_tasks set status='skipped',lease_token=null,error='Cancelled by user' where job_id=p_job and status in ('pending','leased');
    update public.audit_runs set status='truncated', completed_at=now() where id=p_job;
    return;
  end if;
  if j.status not in ('QUEUED','RUNNING') then return; end if;
  update public.crawl_tasks set status=case when attempts > (j.config->>'retries')::integer then 'failed' else 'pending' end,
    lease_token=null,error='Worker interrupted; lease expired' where job_id=p_job and status='leased' and leased_until < now();
  select greatest(0,(j.config->>'concurrency')::integer-count(*)::integer) into slots from public.crawl_tasks where job_id=p_job and status='leased';
  if j.config->>'rendering' <> 'http' then slots := least(slots,2); end if;
  update public.audit_jobs set status='RUNNING', updated_at=now() where id=p_job;
  return query
  update public.crawl_tasks t set status='leased', attempts=t.attempts+1, lease_token=gen_random_uuid(), leased_until=now()+interval '180 seconds'
  where t.id in (select q.id from public.crawl_tasks q where q.job_id=p_job and q.status='pending' and q.available_at<=now() order by q.priority,q.created_at limit slots for update skip locked)
  returning t.*;
end $$;

create function public.commit_audit_task(p_task uuid, p_token uuid, p_records jsonb, p_tasks jsonb, p_error text default null, p_metadata jsonb default '{}') returns boolean
language plpgsql security invoker set search_path = public as $$
declare t public.crawl_tasks; j public.audit_jobs; r jsonb;
begin
  -- Always lock the job before its task, matching the claim/control lock order.
  select * into j from public.audit_jobs where id=(select job_id from public.crawl_tasks where id=p_task) for update;
  select * into t from public.crawl_tasks where id=p_task for update;
  if t.status <> 'leased' or t.lease_token is distinct from p_token then return false; end if;
  if j.status in ('CANCELLING','CANCELLED') then
    update public.crawl_tasks set status='skipped',lease_token=null where id=p_task;
    return false;
  end if;
  if p_error is not null then
    update public.crawl_tasks set status=case when attempts <= (j.config->>'retries')::integer then 'pending' else 'failed' end,
      error=left(p_error,1000),lease_token=null,available_at=now()+make_interval(secs=>least(60,power(2,attempts)::integer)) where id=p_task;
    return true;
  end if;
  for r in select value from jsonb_array_elements(p_records) loop
    insert into public.audit_records(job_id,kind,key,url,source_url,title,category,severity,status,data)
    values(t.job_id,r->>'kind',r->>'key',coalesce(r->>'url',''),r->>'source_url',coalesce(r->>'title',''),r->>'category',r->>'severity',coalesce(r->>'status','open'),coalesce(r->'data','{}'))
    on conflict(job_id,kind,key) do update set data=excluded.data,title=excluded.title,severity=excluded.severity,updated_at=now();
  end loop;
  if p_metadata ? 'robots' then update public.audit_jobs set robots=p_metadata->'robots' where id=t.job_id; end if;
  perform public.enqueue_audit_tasks(t.job_id,p_tasks);
  update public.crawl_tasks set status='done',error=null,lease_token=null,leased_until=null where id=p_task;
  update public.audit_jobs set updated_at=now() where id=t.job_id;
  return true;
end $$;

create function public.audit_job_progress(p_job uuid) returns jsonb
language sql security invoker set search_path = public as $$
  select jsonb_build_object(
    'pending',count(*) filter(where status='pending'), 'running',count(*) filter(where status='leased'),
    'done',count(*) filter(where status='done'), 'failed',count(*) filter(where status='failed'),
    'skipped',count(*) filter(where status='skipped'), 'total',count(*),
    'pages',count(*) filter(where kind='page' and status='done'),
    'images',count(*) filter(where kind='image' and status='done'),
    'nextAttempt',min(available_at) filter(where status='pending'))
  from public.crawl_tasks where job_id=p_job;
$$;

create function public.control_audit_job(p_job uuid, p_action text) returns text
language plpgsql security invoker set search_path = public as $$
declare j public.audit_jobs; next_status text;
begin
  select * into j from public.audit_jobs where id=p_job for update;
  next_status := case
    when p_action='pause' and j.status in ('QUEUED','RUNNING') then 'PAUSED'
    when p_action='resume' and j.status in ('PAUSED','FAILED') then 'QUEUED'
    when p_action='cancel' and j.status in ('QUEUED','RUNNING','PAUSED','FAILED') then 'CANCELLING'
    else j.status end;
  if p_action='resume' and j.status='FAILED' then
    update public.crawl_tasks set status='pending',attempts=0,available_at=now(),lease_token=null where job_id=p_job and status in ('failed','leased');
  end if;
  update public.audit_jobs set status=next_status,updated_at=now(),error=null where id=p_job;
  return next_status;
end $$;

create function public.finalize_audit_job(p_job uuid, p_summary jsonb, p_success boolean, p_partial boolean) returns boolean
language plpgsql security invoker set search_path = public as $$
declare j public.audit_jobs;
begin
  select * into j from public.audit_jobs where id=p_job for update;
  if j.status not in ('QUEUED','RUNNING') then return false; end if;
  if exists(select 1 from public.crawl_tasks where job_id=p_job and status in ('pending','leased')) then return false; end if;
  update public.audit_jobs set status=case when p_success then 'COMPLETED' else 'FAILED' end,
    stage='complete', summary=p_summary, completed_at=now(), updated_at=now(),
    error=case when p_success then null else 'No accessible HTML pages were measured. Review restrictions and failed requests.' end where id=p_job;
  update public.audit_runs set summary=p_summary, completed_at=now(),
    status=case when not p_success then 'failed' when p_partial then 'truncated' else 'completed' end,
    error_message=case when p_success then null else 'No accessible HTML page evidence was collected.' end where id=p_job;
  return true;
end $$;
revoke all on function public.finalize_audit_job(uuid,jsonb,boolean,boolean) from public, anon, authenticated;
grant execute on function public.finalize_audit_job(uuid,jsonb,boolean,boolean) to service_role;

revoke all on function public.enqueue_audit_tasks(uuid,jsonb), public.create_audit_job(uuid,uuid,uuid,text,jsonb), public.claim_audit_tasks(uuid), public.commit_audit_task(uuid,uuid,jsonb,jsonb,text,jsonb), public.audit_job_progress(uuid), public.control_audit_job(uuid,text) from public, anon, authenticated;
grant execute on function public.enqueue_audit_tasks(uuid,jsonb), public.create_audit_job(uuid,uuid,uuid,text,jsonb), public.claim_audit_tasks(uuid), public.commit_audit_task(uuid,uuid,jsonb,jsonb,text,jsonb), public.audit_job_progress(uuid), public.control_audit_job(uuid,text) to service_role;
commit;
