begin;
create table if not exists public.monitoring_configs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  cadence text not null check (cadence in ('daily','weekly')) default 'weekly',
  enabled boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, project_id)
);
alter table public.monitoring_configs enable row level security;
revoke all on public.monitoring_configs from anon, authenticated;
create index if not exists idx_monitoring_configs_owner on public.monitoring_configs(owner_id, updated_at desc);
commit;
