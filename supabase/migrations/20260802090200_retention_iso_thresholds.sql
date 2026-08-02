-- Keep retention comparisons aligned with the ISO-8601 text timestamps used by
-- the application. Casting now() to text produces a space/time-zone format and
-- can make lexical comparisons against stored ISO strings incorrect.
create or replace function public.yape_operational_retention()
returns void
language plpgsql
as $$
declare
  now_utc timestamptz := now() at time zone 'UTC';
  rate_limit_cutoff text := to_char(now_utc - interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  session_cutoff text := to_char(now_utc, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  challenge_cutoff text := session_cutoff;
  reset_cutoff text := session_cutoff;
  qr_cutoff text := to_char(now_utc - interval '180 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  recipient_cutoff text := qr_cutoff;
  telegram_cutoff text := to_char(now_utc - interval '30 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  audit_cutoff text := to_char(now_utc - interval '365 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  delete from public.auth_rate_limits
   where updated_at < rate_limit_cutoff;
  delete from public.sessions
   where expires_at < session_cutoff;
  delete from public.telegram_registration_challenges
   where expires_at < challenge_cutoff;
  delete from public.password_reset_tokens
   where expires_at < reset_cutoff and used_at is not null;
  delete from public.qr_scan_events
   where scanned_at < qr_cutoff;
  delete from public.recipient_lookup_attempts
   where created_at < recipient_cutoff;
  delete from public.telegram_updates
   where received_at < telegram_cutoff;
  delete from public.manager_audit_log
   where created_at < audit_cutoff;
end;
$$;

revoke all on function public.yape_operational_retention() from public;

comment on function public.yape_operational_retention() is
  'Limpieza diaria de sesiones, rate limits y eventos operativos caducados con umbrales ISO-8601.';
