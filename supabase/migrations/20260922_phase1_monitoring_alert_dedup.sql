begin;
alter table public.monitoring_alerts add column if not exists alert_fingerprint text;
create unique index if not exists idx_monitoring_alerts_dedup on public.monitoring_alerts(owner_id, project_id, alert_fingerprint) where status <> 'resolved' and alert_fingerprint is not null;
commit;
