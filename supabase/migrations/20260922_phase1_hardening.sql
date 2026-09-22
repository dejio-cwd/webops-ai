begin;

create table if not exists public.rate_limit_windows (
  bucket_key text primary key,
  request_count integer not null default 0,
  reset_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.rate_limit_windows enable row level security;
revoke all on public.rate_limit_windows from anon, authenticated;

create or replace function public.consume_rate_limit(p_bucket_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare current_count integer; current_time timestamptz := clock_timestamp();
begin
  insert into public.rate_limit_windows(bucket_key, request_count, reset_at, updated_at)
  values (p_bucket_key, 1, current_time + make_interval(secs => p_window_seconds), current_time)
  on conflict (bucket_key) do update set
    request_count = case when rate_limit_windows.reset_at <= current_time then 1 else rate_limit_windows.request_count + 1 end,
    reset_at = case when rate_limit_windows.reset_at <= current_time then current_time + make_interval(secs => p_window_seconds) else rate_limit_windows.reset_at end,
    updated_at = current_time
  returning request_count into current_count;
  return current_count <= p_limit;
end; $$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
create index if not exists idx_rate_limit_reset_at on public.rate_limit_windows(reset_at);

commit;
