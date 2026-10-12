BEGIN;

-- Solo los SMS enviados en las últimas 47 horas todavía se pueden consultar
-- en los logs de Infobip. Los anteriores conservan su estado histórico.
UPDATE public.transfer_sms_notifications
SET status = 'accepted',
    provider_delivery_status = COALESCE(provider_delivery_status, 'ACCEPTED')
WHERE status = 'sent'
  AND provider_message_id IS NOT NULL
  AND created_at::timestamptz >= now() - interval '47 hours';

DROP INDEX IF EXISTS public.transfer_sms_notifications_delivery_reconciliation_idx;

CREATE INDEX transfer_sms_notifications_delivery_reconciliation_idx
  ON public.transfer_sms_notifications(status, created_at)
  WHERE provider_message_id IS NOT NULL AND status = 'accepted';

COMMIT;
