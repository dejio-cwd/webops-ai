begin;
create table if not exists public.fix_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  audit_id text not null,
  opportunity_id text not null,
  title text not null,
  status text not null check (status in ('draft','ready','verified')) default 'draft',
  evidence jsonb not null default '[]'::jsonb,
  recommendation text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, audit_id, opportunity_id)
);
alter table public.fix_records enable row level security;
revoke all on public.fix_records from anon, authenticated;
create index if not exists idx_fix_records_owner_updated on public.fix_records(owner_id, updated_at desc);
commit;
