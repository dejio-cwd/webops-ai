begin;
alter table public.fix_records add column if not exists verification_note text not null default '';
alter table public.fix_records add column if not exists rollback_plan text not null default '';
commit;
