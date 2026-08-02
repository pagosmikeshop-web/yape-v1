-- Explicitly repeat the privilege revocation for environments that previously
-- granted EXECUTE directly to anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;
