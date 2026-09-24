begin;

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin','analyst','developer','viewer','billing')),
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.organization_invitations enable row level security;
revoke all on public.organization_invitations from anon, authenticated;
create index if not exists idx_org_invitations_org on public.organization_invitations(organization_id, created_at desc);
create index if not exists idx_org_invitations_email on public.organization_invitations(lower(email), expires_at);
create index if not exists idx_org_invitations_token on public.organization_invitations(token_hash);

commit;
