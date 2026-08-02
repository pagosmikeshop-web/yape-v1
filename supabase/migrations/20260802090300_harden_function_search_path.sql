-- Prevent caller-controlled objects from being resolved by security-sensitive
-- functions. All application tables are already schema-qualified.
alter function public.yape_daily_transfer_limit_before_movement()
  set search_path = pg_catalog, public;

alter function public.yape_operational_retention()
  set search_path = pg_catalog, public;
