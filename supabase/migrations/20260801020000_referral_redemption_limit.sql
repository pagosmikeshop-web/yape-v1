-- /redeem is a lifetime allowance per referrer account, not a monthly quota.
-- Existing redemption rows are preserved and counted before the new flow is used.
alter table public.users
  add column if not exists referral_redemption_count integer not null default 0;

update public.users as u
set referral_redemption_count = counts.total
from (
  select referrer_user_id, count(*)::integer as total
  from public.referral_redemptions
  group by referrer_user_id
) as counts
where u.id = counts.referrer_user_id
  and u.referral_redemption_count < counts.total;

alter table public.users
  drop constraint if exists users_referral_redemption_count_check;

alter table public.users
  add constraint users_referral_redemption_count_check
  check (referral_redemption_count >= 0);
