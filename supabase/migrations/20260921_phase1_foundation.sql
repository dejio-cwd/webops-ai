begin;

create extension if not exists pgcrypto;

-- Fresh Supabase projects do not yet have the original scaffold tables.
-- Create the required project table first so this migration is standalone.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  domain text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','analyst','developer','viewer','billing')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

alter table public.projects add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.projects add column if not exists environment text not null default 'production';
alter table public.projects add column if not exists verified_at timestamptz;
alter table public.projects add column if not exists settings jsonb not null default '{}'::jsonb;

create table if not exists public.domain_verifications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  method text not null check (method in ('dns','file','meta')),
  token_hash text not null,
  status text not null default 'pending' check (status in ('pending','verified','expired','failed')),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.provider_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  provider text not null,
  display_name text not null,
  encrypted_secret text not null,
  key_hint text,
  base_url text,
  model_allowlist jsonb not null default '[]'::jsonb,
  scopes jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active','revoked','rotating')),
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  revoked_at timestamptz
);

create or replace function public.is_org_member(org_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.organization_members m where m.organization_id = org_id and m.user_id = auth.uid()); $$;

create or replace function public.has_org_role(org_id uuid, allowed text[])
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.organization_members m where m.organization_id = org_id and m.user_id = auth.uid() and m.role = any(allowed)); $$;

alter table public.projects enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.domain_verifications enable row level security;
alter table public.audit_events enable row level security;
alter table public.provider_credentials enable row level security;

drop policy if exists "owners manage projects" on public.projects;
drop policy if exists "members read organizations" on public.organizations;
drop policy if exists "owners update organizations" on public.organizations;
drop policy if exists "members read membership" on public.organization_members;
drop policy if exists "admins manage membership" on public.organization_members;
drop policy if exists "members read domain verification" on public.domain_verifications;
drop policy if exists "admins manage domain verification" on public.domain_verifications;
drop policy if exists "members read audit events" on public.audit_events;
drop policy if exists "admins manage credentials" on public.provider_credentials;

create policy "owners manage projects" on public.projects for all
  using (owner_id = auth.uid() or public.is_org_member(organization_id))
  with check (owner_id = auth.uid() and (organization_id is null or public.is_org_member(organization_id)));
create policy "members read organizations" on public.organizations for select using (public.is_org_member(id));
create policy "owners update organizations" on public.organizations for update using (public.has_org_role(id, array['owner','admin']));
create policy "members read membership" on public.organization_members for select using (public.is_org_member(organization_id));
create policy "admins manage membership" on public.organization_members for all using (public.has_org_role(organization_id, array['owner','admin'])) with check (public.has_org_role(organization_id, array['owner','admin']));
create policy "members read domain verification" on public.domain_verifications for select using (exists(select 1 from public.projects p where p.id=project_id and public.is_org_member(p.organization_id)));
create policy "admins manage domain verification" on public.domain_verifications for all using (exists(select 1 from public.projects p where p.id=project_id and public.has_org_role(p.organization_id, array['owner','admin','developer']))) with check (exists(select 1 from public.projects p where p.id=project_id and public.has_org_role(p.organization_id, array['owner','admin','developer'])));
create policy "members read audit events" on public.audit_events for select using (public.is_org_member(organization_id));
create policy "admins manage credentials" on public.provider_credentials for all using (public.has_org_role(organization_id, array['owner','admin'])) with check (public.has_org_role(organization_id, array['owner','admin']));

create index if not exists idx_projects_organization on public.projects(organization_id);
create index if not exists idx_audit_events_org_created on public.audit_events(organization_id, created_at desc);
create index if not exists idx_credentials_org on public.provider_credentials(organization_id);

commit;
