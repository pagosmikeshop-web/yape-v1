-- Extend existing finite-access accounts to a fresh 30-day window.
-- Permanent accounts are represented by access_expires_at IS NULL and are
-- intentionally excluded. Deleted accounts are excluded as well.
BEGIN;

UPDATE public.users
SET access_expires_at = to_char(
      (now() AT TIME ZONE 'UTC') + interval '30 days',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    updated_at = to_char(
      now() AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
WHERE deleted_at IS NULL
  AND access_expires_at IS NOT NULL;

COMMIT;
