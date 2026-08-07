-- A Telegram ID can redeem only once for its lifetime.
-- This ledger intentionally has no foreign key to the referrer: deleting a
-- target account must not allow a previously used Telegram ID to redeem again.
create table if not exists public.referral_redeemer_claims (
  telegram_user_id text primary key,
  referrer_user_id text not null,
  redemption_id text not null unique,
  created_at text not null
);

create index if not exists referral_redeemer_claims_referrer_idx
  on public.referral_redeemer_claims (referrer_user_id);

-- Preserve the lifetime rule for redemptions that already exist.
insert into public.referral_redeemer_claims
  (telegram_user_id, referrer_user_id, redemption_id, created_at)
select
  redeemer_telegram_user_id,
  min(referrer_user_id),
  min(id),
  min(created_at)
from public.referral_redemptions
group by redeemer_telegram_user_id
on conflict (telegram_user_id) do nothing;

alter table public.referral_redeemer_claims enable row level security;

-- The application accesses this table only through the server-side database
-- connection. It must never be readable or writable from the public Data API.
revoke all privileges on table public.referral_redeemer_claims from anon, authenticated;
