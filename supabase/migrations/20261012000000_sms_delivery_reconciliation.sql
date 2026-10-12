BEGIN;

ALTER TABLE public.transfer_sms_notifications
  DROP CONSTRAINT IF EXISTS transfer_sms_notifications_status_check;

ALTER TABLE public.transfer_sms_notifications
  ADD COLUMN IF NOT EXISTS delivery_callback_hash text,
  ADD COLUMN IF NOT EXISTS provider_delivery_status text,
  ADD COLUMN IF NOT EXISTS delivery_checked_at text,
  ADD COLUMN IF NOT EXISTS delivery_finalized_at text;

ALTER TABLE public.transfer_sms_notifications
  ADD CONSTRAINT transfer_sms_notifications_status_check
  CHECK (status IN ('pending', 'reserved', 'accepted', 'sent', 'delivered', 'failed', 'skipped'));

CREATE INDEX IF NOT EXISTS transfer_sms_notifications_delivery_reconciliation_idx
  ON public.transfer_sms_notifications(status, created_at)
  WHERE provider_message_id IS NOT NULL AND status IN ('accepted', 'sent');

CREATE UNIQUE INDEX IF NOT EXISTS transfer_sms_notifications_delivery_callback_hash_idx
  ON public.transfer_sms_notifications(delivery_callback_hash)
  WHERE delivery_callback_hash IS NOT NULL;

COMMIT;
