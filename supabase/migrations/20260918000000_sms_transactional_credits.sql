BEGIN;

CREATE TABLE IF NOT EXISTS public.account_sms_settings (
  user_id text PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  enabled integer NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  display_name text NOT NULL DEFAULT '',
  credit_balance bigint NOT NULL DEFAULT 0 CHECK (credit_balance >= 0),
  last_reservation_id text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sms_credit_tokens (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  token_hint text NOT NULL,
  credits bigint NOT NULL CHECK (credits > 0),
  created_by text NOT NULL REFERENCES public.users(id),
  created_at text NOT NULL,
  revoked_at text,
  redeemed_at text,
  redeemed_by_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  redeemed_ledger_id text
);
CREATE INDEX IF NOT EXISTS sms_credit_tokens_created_idx
  ON public.sms_credit_tokens(created_at);

CREATE TABLE IF NOT EXISTS public.sms_credit_ledger (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  delta bigint NOT NULL,
  reason text NOT NULL,
  reference_id text NOT NULL,
  created_at text NOT NULL,
  UNIQUE(reason, reference_id)
);
CREATE INDEX IF NOT EXISTS sms_credit_ledger_user_created_idx
  ON public.sms_credit_ledger(user_id, created_at);

CREATE TABLE IF NOT EXISTS public.transfer_sms_notifications (
  id text PRIMARY KEY,
  movement_id text NOT NULL UNIQUE REFERENCES public.account_movements(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'reserved', 'sent', 'failed', 'skipped')),
  reservation_id text,
  refund_ledger_id text,
  recipient_reference text NOT NULL DEFAULT '',
  provider_message_id text,
  failure_code text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS transfer_sms_notifications_user_created_idx
  ON public.transfer_sms_notifications(user_id, created_at);

-- Las activaciones antiguas no tenían créditos; quedan deshabilitadas hasta
-- que la cuenta canjee un token administrativo de SMS.
INSERT INTO public.account_sms_settings (
  user_id, enabled, display_name, credit_balance, last_reservation_id, created_at, updated_at
)
SELECT user_id, 0, '', 0, NULL,
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM public.account_feature_entitlements
WHERE kind = 'sms'
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
