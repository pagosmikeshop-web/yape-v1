-- Validación server-side y auditoría de lecturas QR.
-- Los QR existentes conservan su payload cifrado; estas columnas agregan
-- vigencia y consumo sin cambiar el contrato de creación actual.

alter table public.global_qr_directory
  add column if not exists expires_at text,
  add column if not exists max_uses integer,
  add column if not exists usage_count integer not null default 0,
  add column if not exists single_use integer not null default 0,
  add column if not exists last_used_at text;

alter table public.global_qr_directory
  drop constraint if exists global_qr_directory_usage_check;
alter table public.global_qr_directory
  add constraint global_qr_directory_usage_check
  check (usage_count >= 0 and (max_uses is null or max_uses > 0));
alter table public.global_qr_directory
  drop constraint if exists global_qr_directory_single_use_check;
alter table public.global_qr_directory
  add constraint global_qr_directory_single_use_check
  check (single_use in (0, 1));

create index if not exists global_qr_directory_scan_lookup_idx
  on public.global_qr_directory (payload_hash, status, expires_at);

create table if not exists public.qr_scan_events (
  id text primary key,
  qr_id text references public.global_qr_directory(id) on delete set null,
  scanned_value_hash text not null,
  scanned_by_user_id text not null references public.users(id) on delete cascade,
  idempotency_key text not null,
  scan_status text not null check (scan_status in (
    'valid', 'payment_valid', 'invalid', 'not_found', 'expired', 'disabled',
    'already_used', 'usage_limit_reached', 'unauthorized', 'server_error'
  )),
  error_code text,
  response_payload text,
  device_information text,
  user_agent text,
  scanned_at text not null
);

create unique index if not exists qr_scan_events_idempotency_unique
  on public.qr_scan_events (scanned_by_user_id, idempotency_key);
create index if not exists qr_scan_events_qr_time_idx
  on public.qr_scan_events (qr_id, scanned_at);
create index if not exists qr_scan_events_user_time_idx
  on public.qr_scan_events (scanned_by_user_id, scanned_at);

-- La aplicación usa la conexión privada del servidor. La Data API no debe
-- permitir lecturas/escrituras directas de QR ni de su auditoría.
alter table public.qr_scan_events enable row level security;
revoke all on table public.global_qr_directory from anon, authenticated;
revoke all on table public.qr_scan_events from anon, authenticated;
