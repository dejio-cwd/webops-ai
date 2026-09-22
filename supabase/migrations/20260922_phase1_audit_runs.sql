begin;

create table if not exists public.audit_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  url text not null,
  audit_id text not null unique,
  engine_version text not null,
  status text not null check (status in ('running','completed','truncated','failed')),
  summary jsonb not null default '{}'::jsonb,
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.audit_runs enable row level security;
revoke all on public.audit_runs from anon, authenticated;
create index if not exists idx_audit_runs_owner_created on public.audit_runs(owner_id, created_at desc);
create index if not exists idx_audit_runs_project_created on public.audit_runs(project_id, created_at desc);

commit;
