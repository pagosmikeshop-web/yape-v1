-- Permanent moderation blacklist. This table intentionally has no foreign key
-- to users: a banned identity must remain blocked after its account is deleted.
create table if not exists public.account_blacklist (
  id text primary key,
  telegram_user_id text not null,
  reason text,
  banned_by_user_id text,
  banned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint account_blacklist_telegram_user_id_key unique (telegram_user_id)
);

create index if not exists account_blacklist_telegram_user_id_idx
  on public.account_blacklist (telegram_user_id);

alter table public.account_blacklist enable row level security;

revoke all on table public.account_blacklist from anon, authenticated;
