-- Harden privileged database functions without changing application data.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;
ALTER FUNCTION public.yape_deduct_balance_before_movement() SET search_path = public;
ALTER FUNCTION public.yape_daily_transfer_limit_before_movement() SET search_path = public;
