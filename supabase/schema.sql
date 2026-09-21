-- Optional Supabase persistence. The UI works without Supabase.
create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  domain text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.audits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null check (status in ('queued','running','completed','failed','cancelled')),
  mode text not null default 'hybrid',
  settings jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  url text not null,
  normalized_url text not null,
  http_status integer,
  response_time_ms integer,
  title text,
  meta_description text,
  h1 text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (audit_id, normalized_url)
);

create table if not exists public.findings (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  page_id uuid references public.pages(id) on delete cascade,
  rule_id text not null,
  category text not null,
  severity text not null check (severity in ('CRITICAL','HIGH','MEDIUM','LOW','INFO')),
  title text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.projects enable row level security;
alter table public.audits enable row level security;
alter table public.pages enable row level security;
alter table public.findings enable row level security;

create policy "owners manage projects" on public.projects for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners manage audits" on public.audits for all using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())) with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
create policy "owners manage pages" on public.pages for all using (exists (select 1 from public.audits a join public.projects p on p.id = a.project_id where a.id = audit_id and p.owner_id = auth.uid())) with check (exists (select 1 from public.audits a join public.projects p on p.id = a.project_id where a.id = audit_id and p.owner_id = auth.uid()));
create policy "owners manage findings" on public.findings for all using (exists (select 1 from public.audits a join public.projects p on p.id = a.project_id where a.id = audit_id and p.owner_id = auth.uid())) with check (exists (select 1 from public.audits a join public.projects p on p.id = a.project_id where a.id = audit_id and p.owner_id = auth.uid()));


-- Premium intelligence and AI Studio foundations
create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  title text not null,
  score numeric,
  severity text not null,
  affected_count integer not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  recommendation jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists public.ai_providers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  display_name text not null,
  base_url text,
  enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_credentials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider_id uuid not null references public.ai_providers(id) on delete cascade,
  encrypted_secret text not null,
  key_hint text,
  purpose text,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create table if not exists public.ai_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  audit_id uuid references public.audits(id) on delete cascade,
  task_type text not null,
  status text not null,
  provider text,
  model text,
  prompt_version text,
  evidence_refs jsonb not null default '[]'::jsonb,
  structured_output jsonb,
  input_tokens integer,
  output_tokens integer,
  estimated_cost numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.monitoring_profiles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  frequency text not null,
  crawl_config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  provider text not null,
  status text not null default 'disconnected',
  encrypted_config text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.opportunities enable row level security;
alter table public.ai_providers enable row level security;
alter table public.ai_credentials enable row level security;
alter table public.ai_tasks enable row level security;
alter table public.monitoring_profiles enable row level security;
alter table public.integrations enable row level security;

create policy "owners manage opportunities" on public.opportunities for all using (exists (select 1 from public.audits a join public.projects p on p.id=a.project_id where a.id=audit_id and p.owner_id=auth.uid()));
create policy "owners manage ai providers" on public.ai_providers for all using (owner_id=auth.uid()) with check (owner_id=auth.uid());
create policy "owners manage ai credentials" on public.ai_credentials for all using (owner_id=auth.uid()) with check (owner_id=auth.uid());
create policy "owners manage ai tasks" on public.ai_tasks for all using (owner_id=auth.uid()) with check (owner_id=auth.uid());
create policy "owners manage monitoring" on public.monitoring_profiles for all using (exists (select 1 from public.projects p where p.id=project_id and p.owner_id=auth.uid()));
create policy "owners manage integrations" on public.integrations for all using (exists (select 1 from public.projects p where p.id=project_id and p.owner_id=auth.uid()));
