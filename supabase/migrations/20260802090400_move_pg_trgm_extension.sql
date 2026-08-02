-- Supabase recommends keeping extensions outside public so extension objects
-- are not accidentally exposed as part of the application API schema.
create schema if not exists extensions;

alter extension pg_trgm set schema extensions;

grant usage on schema extensions to postgres, anon, authenticated, service_role;
