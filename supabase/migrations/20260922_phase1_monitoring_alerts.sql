begin;
create table if not exists public.monitoring_alerts (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, project_id uuid not null references public.projects(id) on delete cascade, audit_id text not null, kind text not null check (kind in ('regression','failure')), severity text not null check (severity in ('critical','high','medium','low')), summary jsonb not null default '{}'::jsonb, status text not null check (status in ('open','acknowledged','resolved')) default 'open', created_at timestamptz not null default now(), resolved_at timestamptz
);
alter table public.monitoring_alerts enable row level security;
revoke all on public.monitoring_alerts from anon, authenticated;
create index if not exists idx_monitoring_alerts_owner_created on public.monitoring_alerts(owner_id, created_at desc);
commit;
