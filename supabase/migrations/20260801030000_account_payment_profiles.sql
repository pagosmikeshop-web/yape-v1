create table if not exists public.account_payment_profiles (
  user_id text primary key references public.users(id) on delete cascade,
  phone_e164 text,
  qr_payload_ciphertext text,
  qr_payload_iv text,
  accuracy_confirmed_at text not null,
  created_at text not null,
  updated_at text not null,
  constraint account_payment_profiles_contact_check check (
    phone_e164 is not null or qr_payload_ciphertext is not null
  ),
  constraint account_payment_profiles_qr_pair_check check (
    (qr_payload_ciphertext is null and qr_payload_iv is null)
    or (qr_payload_ciphertext is not null and qr_payload_iv is not null)
  )
);

create unique index if not exists account_payment_profiles_phone_unique
  on public.account_payment_profiles(phone_e164)
  where phone_e164 is not null;

create index if not exists account_payment_profiles_updated_idx
  on public.account_payment_profiles(updated_at);

alter table public.account_payment_profiles enable row level security;
