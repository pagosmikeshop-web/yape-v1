-- Publica destinatarios y QR para el autocompletado global.
-- La aplicación escribe mediante su conexión privada de servidor; RLS queda
-- activado como defensa adicional si la Data API se habilita en el proyecto.

create table if not exists public.global_recipient_directory (
  id text primary key,
  phone_e164 text not null,
  display_name text not null,
  source text not null default 'manual' check (source in ('manual', 'qr')),
  submitted_by_user_id text not null references public.users(id) on delete cascade,
  terms_version text not null,
  terms_accepted_at text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at text not null,
  updated_at text not null,
  revoked_at text,
  revoked_reason text
);

create unique index if not exists global_recipient_directory_phone_unique
  on public.global_recipient_directory (phone_e164);
create index if not exists global_recipient_directory_submitter_idx
  on public.global_recipient_directory (submitted_by_user_id, updated_at);
create index if not exists global_recipient_directory_active_idx
  on public.global_recipient_directory (phone_e164, status);

create table if not exists public.global_qr_directory (
  id text primary key,
  holder_name text not null,
  phone_e164 text,
  provider text not null,
  recipient_user_id text references public.users(id) on delete set null,
  submitted_by_user_id text not null references public.users(id) on delete cascade,
  qr_payload_ciphertext text not null,
  qr_payload_iv text not null,
  payload_hash text not null,
  encryption_version integer not null default 1 check (encryption_version = 1),
  terms_version text not null,
  terms_accepted_at text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at text not null,
  updated_at text not null,
  revoked_at text,
  revoked_reason text,
  check (phone_e164 is not null or recipient_user_id is not null),
  check (provider in ('Yape', 'Plin', 'BCP', 'BBVA', 'Interbank', 'Scotiabank', 'Bim', 'Banco Falabella', 'Banco Pichincha', 'Dale!', 'Izipay', 'Agora / Oh!', 'Tunki'))
);

create unique index if not exists global_qr_directory_payload_unique
  on public.global_qr_directory (payload_hash);
create index if not exists global_qr_directory_submitter_idx
  on public.global_qr_directory (submitted_by_user_id, updated_at);
create index if not exists global_qr_directory_phone_idx
  on public.global_qr_directory (phone_e164, status);
create index if not exists global_qr_directory_recipient_idx
  on public.global_qr_directory (recipient_user_id);

alter table public.global_recipient_directory enable row level security;
alter table public.global_qr_directory enable row level security;

