begin;

-- Project reads and mutations are mediated by the authenticated application API,
-- which applies organization-role checks before using the service role. Do not
-- expose the projects table directly through PostgREST client roles.
revoke all on table public.projects from anon, authenticated;

commit;
