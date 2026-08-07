-- Supabase/Postgres schema for banco-web.
-- Apply this migration before setting DATABASE_PROVIDER=supabase.
-- The application keeps identifiers and timestamps as text to preserve the
-- existing application contract during the Postgres migration.

create table if not exists public.users (
  id text primary key,
  seller_code text not null,
  username text not null,
  display_name text not null,
  email text not null default '',
  role text not null,
  is_owner integer not null default 0 check (is_owner in (0, 1)),
  owner_id text,
  status text not null default 'pending',
  password_hash text not null,
  password_salt text not null,
  pin_hash text,
  pin_salt text,
  credits integer not null default 0,
  device_id text,
  device_public_key text,
  fingerprint_id_hash text,
  telegram_user_id text,
  referral_code text,
  referred_by_user_id text,
  access_expires_at text,
  must_change_password integer not null default 0 check (must_change_password in (0, 1)),
  must_set_pin integer not null default 1 check (must_set_pin in (0, 1)),
  created_at text not null,
  updated_at text not null,
  activated_at text,
  deleted_at text
);

create unique index if not exists users_login_unique on public.users (seller_code, username);
create unique index if not exists users_device_unique on public.users (device_id) where device_id is not null;
create unique index if not exists users_fingerprint_unique on public.users (fingerprint_id_hash) where fingerprint_id_hash is not null;
create unique index if not exists users_telegram_user_unique on public.users (telegram_user_id) where telegram_user_id is not null;
create unique index if not exists users_referral_code_unique on public.users (referral_code) where referral_code is not null;
create index if not exists users_owner_role_idx on public.users (owner_id, role, deleted_at);
create index if not exists users_role_deleted_created_idx on public.users (role, deleted_at, created_at);

create table if not exists public.user_roles (
  user_id text not null references public.users(id) on delete cascade,
  role text not null check (role in ('admin', 'seller', 'client')),
  granted_by text references public.users(id) on delete set null,
  created_at text not null,
  primary key (user_id, role)
);
create index if not exists user_roles_role_idx on public.user_roles (role, user_id);

create table if not exists public.sessions (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  created_at text not null,
  expires_at text not null,
  last_seen_at text not null,
  pin_verified_at text,
  unlocked_until text
);
create index if not exists sessions_user_idx on public.sessions (user_id);
create index if not exists sessions_expiry_idx on public.sessions (expires_at);

create table if not exists public.auth_rate_limits (
  bucket text not null,
  subject_hash text not null,
  window_started_at bigint not null,
  attempt_count integer not null default 0,
  updated_at text not null,
  primary key (bucket, subject_hash)
);
create index if not exists auth_rate_limits_updated_idx on public.auth_rate_limits (updated_at);

create table if not exists public.payment_directory (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  phone_e164 text not null,
  discoverable integer not null default 1 check (discoverable in (0, 1)),
  verified_at text not null,
  created_at text not null,
  updated_at text not null
);
create unique index if not exists payment_directory_user_unique on public.payment_directory (user_id);
create unique index if not exists payment_directory_phone_unique on public.payment_directory (phone_e164);

create table if not exists public.recipient_lookup_attempts (
  id text primary key,
  requester_user_id text not null references public.users(id) on delete cascade,
  created_at text not null
);
create index if not exists recipient_lookup_requester_idx on public.recipient_lookup_attempts (requester_user_id, created_at);

create table if not exists public.saved_payment_recipients (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  phone_e164 text not null,
  display_name text not null default 'Número nuevo',
  source text not null default 'manual',
  created_at text not null,
  updated_at text not null
);
create unique index if not exists saved_payment_recipients_user_phone_unique on public.saved_payment_recipients (user_id, phone_e164);
create index if not exists saved_payment_recipients_user_updated_idx on public.saved_payment_recipients (user_id, updated_at);

create table if not exists public.account_balances (
  user_id text primary key references public.users(id) on delete cascade,
  balance_cents integer not null default 3913 check (balance_cents >= 0 and balance_cents <= 100000000),
  is_configured integer not null default 0 check (is_configured in (0, 1)),
  updated_at text not null
);

create table if not exists public.account_movements (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  recipient_name text not null,
  recipient_reference text not null,
  recipient_user_id text references public.users(id) on delete set null,
  saved_recipient_id text references public.saved_payment_recipients(id) on delete set null,
  destination text not null default 'Yape',
  amount_cents integer not null check (amount_cents > 0),
  message text not null default '',
  security_code text not null,
  operation_number text not null unique,
  idempotency_key text,
  created_at text not null
);
create unique index if not exists account_movements_user_idempotency_unique on public.account_movements (user_id, idempotency_key) where idempotency_key is not null;
create index if not exists account_movements_user_created_idx on public.account_movements (user_id, created_at);
create index if not exists account_movements_recipient_user_idx on public.account_movements (recipient_user_id);

create table if not exists public.account_history_state (
  user_id text primary key references public.users(id) on delete cascade,
  cleared_at text not null
);

create table if not exists public.account_feature_entitlements (
  user_id text not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('sms', 'auto')),
  enabled integer not null default 1 check (enabled in (0, 1)),
  validated_at text not null,
  updated_at text not null,
  primary key (user_id, kind)
);
create index if not exists account_feature_entitlements_user_idx on public.account_feature_entitlements (user_id, kind);

create table if not exists public.autocomplete_keys (
  id text primary key,
  token_hash text not null unique,
  token_hint text not null,
  credits_total integer not null check (credits_total > 0),
  credits_remaining integer not null check (credits_remaining >= 0),
  created_by text not null references public.users(id),
  created_at text not null,
  revoked_at text,
  token_ciphertext text
);
create index if not exists autocomplete_keys_created_idx on public.autocomplete_keys (created_at);

create table if not exists public.autocomplete_key_claims (
  key_id text primary key references public.autocomplete_keys(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  claimed_at text not null
);
create index if not exists autocomplete_key_claims_user_idx on public.autocomplete_key_claims (user_id, claimed_at);

create table if not exists public.credit_ledger (
  id text primary key,
  seller_id text not null references public.users(id),
  delta integer not null,
  balance_after integer not null,
  reason text not null,
  reference_id text not null,
  created_by text not null references public.users(id),
  created_at text not null,
  unique (reason, reference_id)
);

create table if not exists public.activations (
  id text primary key,
  user_id text not null unique references public.users(id),
  seller_id text not null references public.users(id),
  credits_charged integer not null default 1,
  created_at text not null
);

create table if not exists public.permanent_access_tokens (
  id text primary key,
  token_hash text not null unique,
  token_hint text not null,
  seller_id text not null references public.users(id),
  user_id text not null references public.users(id) on delete cascade,
  created_by text not null references public.users(id),
  created_at text not null,
  redeemed_at text
);
create index if not exists permanent_access_tokens_seller_idx on public.permanent_access_tokens (seller_id, created_at);
create index if not exists permanent_access_tokens_user_idx on public.permanent_access_tokens (user_id, created_at);

create table if not exists public.global_permanent_access_tokens (
  id text primary key,
  token_hash text not null unique,
  token_hint text not null,
  created_by text not null references public.users(id),
  created_at text not null,
  redeemed_at text,
  redeemed_by_user_id text,
  token_ciphertext text
);
create index if not exists global_permanent_access_tokens_created_idx on public.global_permanent_access_tokens (created_at);
create index if not exists global_permanent_access_tokens_redeemed_idx on public.global_permanent_access_tokens (redeemed_at);

create table if not exists public.password_reset_requests (
  id text primary key,
  user_id text not null references public.users(id),
  seller_id text not null references public.users(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'cancelled')),
  price_credits integer not null default 1,
  created_at text not null,
  approved_at text,
  approved_by text references public.users(id)
);
create index if not exists password_reset_seller_idx on public.password_reset_requests (seller_id, status);

create table if not exists public.password_reset_tokens (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  subject_hash text not null,
  created_at text not null,
  expires_at text not null,
  used_at text,
  consumed_by text
);
create index if not exists password_reset_tokens_user_idx on public.password_reset_tokens (user_id, created_at);
create index if not exists password_reset_tokens_expiry_idx on public.password_reset_tokens (expires_at);

create table if not exists public.account_invitations (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  created_at text not null,
  expires_at text not null,
  used_at text,
  consumed_by text
);
create index if not exists account_invitations_user_idx on public.account_invitations (user_id, created_at);
create index if not exists account_invitations_expiry_idx on public.account_invitations (expires_at);

create table if not exists public.qr_contacts (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  holder_name text not null,
  phone_e164 text,
  provider text not null,
  recipient_user_id text references public.users(id) on delete set null,
  qr_payload_ciphertext text not null,
  qr_payload_iv text not null,
  payload_hash text not null,
  encryption_version integer not null default 1 check (encryption_version = 1),
  created_at text not null,
  updated_at text not null,
  check (provider in ('Mi Banco', 'Yape', 'Plin', 'BCP', 'BBVA', 'Interbank', 'Scotiabank', 'Bim', 'Banco Falabella', 'Banco Pichincha', 'Dale!', 'Izipay', 'Agora / Oh!', 'Tunki'))
);
create unique index if not exists qr_contacts_user_payload_unique on public.qr_contacts (user_id, payload_hash);
create index if not exists qr_contacts_user_updated_idx on public.qr_contacts (user_id, updated_at);
create index if not exists qr_contacts_recipient_idx on public.qr_contacts (recipient_user_id);

create table if not exists public.telegram_identities (
  telegram_user_id text primary key,
  user_id text not null unique references public.users(id) on delete cascade,
  created_at text not null
);
create index if not exists telegram_identity_user_idx on public.telegram_identities (user_id);

create table if not exists public.telegram_updates (
  update_id text primary key,
  received_at text not null
);

create table if not exists public.telegram_registration_challenges (
  id text primary key,
  code_hash text not null unique,
  telegram_user_id text not null,
  fingerprint_hash text not null,
  created_at text not null,
  expires_at text not null,
  verified_at text,
  consumed_at text
);
create index if not exists telegram_registration_challenges_lookup_idx on public.telegram_registration_challenges (telegram_user_id, fingerprint_hash, expires_at);
create index if not exists telegram_registration_challenges_expiry_idx on public.telegram_registration_challenges (expires_at);

create table if not exists public.telegram_group_members (
  telegram_user_id text primary key,
  chat_id text not null,
  username text,
  display_name text,
  first_seen_at text not null,
  last_seen_at text not null
);
create index if not exists telegram_group_members_chat_idx on public.telegram_group_members (chat_id, last_seen_at);

create table if not exists public.referral_redemptions (
  id text primary key,
  referrer_user_id text not null references public.users(id) on delete cascade,
  redeemer_telegram_user_id text not null,
  redeemed_by_user_id text references public.users(id) on delete set null,
  month_key text not null,
  created_at text not null,
  unique (referrer_user_id, redeemer_telegram_user_id, month_key)
);
create index if not exists referral_redemptions_referrer_month_idx on public.referral_redemptions (referrer_user_id, month_key);

create table if not exists public.manager_audit_log (
  id text primary key,
  telegram_user_id text not null,
  command text not null,
  outcome text not null,
  created_at text not null
);

create table if not exists public.rbac_permission_overrides (
  user_id text not null references public.users(id) on delete cascade,
  permission text not null,
  effect text not null check (effect in ('allow', 'deny')),
  updated_by text not null references public.users(id),
  updated_at text not null,
  primary key (user_id, permission)
);
create index if not exists rbac_permission_overrides_user_idx on public.rbac_permission_overrides (user_id);

create table if not exists public.client_crm_profiles (
  user_id text primary key references public.users(id) on delete cascade,
  crm_status text not null default 'new' check (crm_status in ('new', 'vip')),
  client_type text not null default 'individual' check (client_type in ('individual', 'business')),
  category text not null default 'general',
  tags_json text not null default '[]',
  notes text not null default '',
  last_activity_at text,
  updated_by text references public.users(id),
  updated_at text not null
);
create index if not exists client_crm_profiles_status_idx on public.client_crm_profiles (crm_status, category);
create index if not exists client_crm_profiles_activity_idx on public.client_crm_profiles (last_activity_at);

create table if not exists public.client_crm_activities (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  activity_type text not null check (activity_type in ('purchase', 'payment', 'conversation', 'quote', 'note', 'status')),
  title text not null,
  description text not null default '',
  amount_cents integer not null default 0 check (amount_cents >= 0),
  created_by text not null references public.users(id),
  created_at text not null
);
create index if not exists client_crm_activities_user_idx on public.client_crm_activities (user_id, created_at);
create index if not exists client_crm_activities_type_idx on public.client_crm_activities (activity_type, created_at);

create table if not exists public.webauthn_credentials (
  credential_id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  public_key text not null,
  counter integer not null default 0,
  transports text,
  device_type text,
  backed_up integer not null default 0 check (backed_up in (0, 1)),
  created_at text not null,
  last_used_at text
);
create index if not exists webauthn_credentials_user_idx on public.webauthn_credentials (user_id);

create table if not exists public.webauthn_challenges (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  type text not null check (type in ('registration', 'authentication')),
  challenge text not null,
  expires_at text not null,
  created_at text not null
);
create index if not exists webauthn_challenges_user_type_idx on public.webauthn_challenges (user_id, type);
create index if not exists webauthn_challenges_expiry_idx on public.webauthn_challenges (expires_at);

-- Preserve the balance and daily transfer invariants enforced by the
-- triggers. These functions run inside the same Postgres transaction as the
-- movement insert.
create or replace function public.yape_deduct_balance_before_movement()
returns trigger
language plpgsql
as $$
declare
  affected integer;
begin
  if current_setting('yape.importing', true) = 'true' then
    return new;
  end if;
  update public.account_balances
  set balance_cents = balance_cents - new.amount_cents,
      updated_at = new.created_at
  where user_id = new.user_id
    and is_configured = 1
    and balance_cents >= new.amount_cents;
  get diagnostics affected = row_count;
  if affected = 0 then
    raise exception 'INSUFFICIENT_BALANCE';
  end if;
  return new;
end;
$$;

drop trigger if exists account_movements_deduct_balance on public.account_movements;
create trigger account_movements_deduct_balance
before insert on public.account_movements
for each row execute function public.yape_deduct_balance_before_movement();

create or replace function public.yape_daily_transfer_limit_before_movement()
returns trigger
language plpgsql
as $$
declare
  total_cents integer;
begin
  if current_setting('yape.importing', true) = 'true' then
    return new;
  end if;
  select coalesce(sum(amount_cents), 0)
    into total_cents
    from public.account_movements
   where user_id = new.user_id
     and ((created_at::timestamptz - interval '5 hours')::date)
       = ((new.created_at::timestamptz - interval '5 hours')::date);
  if total_cents + new.amount_cents > 200000 then
    raise exception 'DAILY_LIMIT_EXCEEDED';
  end if;
  return new;
end;
$$;

drop trigger if exists account_movements_daily_limit on public.account_movements;
create trigger account_movements_daily_limit
before insert on public.account_movements
for each row execute function public.yape_daily_transfer_limit_before_movement();

-- The app uses a private server-side Postgres connection. Keep the tables
-- protected if Supabase's Data API is enabled later; no anonymous policies are
-- created, so the browser cannot read financial or authentication data.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'users', 'user_roles', 'sessions', 'auth_rate_limits',
    'payment_directory', 'recipient_lookup_attempts', 'saved_payment_recipients',
    'account_balances', 'account_movements', 'account_history_state',
    'account_feature_entitlements', 'autocomplete_keys', 'autocomplete_key_claims',
    'credit_ledger', 'activations', 'permanent_access_tokens',
    'global_permanent_access_tokens', 'password_reset_requests',
    'password_reset_tokens', 'account_invitations', 'qr_contacts',
    'telegram_identities', 'telegram_updates', 'telegram_registration_challenges',
    'telegram_group_members', 'referral_redemptions', 'manager_audit_log',
    'rbac_permission_overrides', 'client_crm_profiles', 'client_crm_activities',
    'webauthn_credentials', 'webauthn_challenges'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end;
$$;
