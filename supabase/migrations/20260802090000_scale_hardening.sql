-- Escalabilidad para Supabase Pro.
-- Esta migración no elimina datos de negocio: solo agrega índices, amplía
-- contadores y programa la limpieza de datos operativos ya caducados.

create index if not exists activations_seller_idx
  on public.activations (seller_id, created_at);
create index if not exists autocomplete_keys_created_by_idx
  on public.autocomplete_keys (created_by, created_at);
create index if not exists client_crm_activities_created_by_idx
  on public.client_crm_activities (created_by, created_at);
create index if not exists client_crm_profiles_updated_by_idx
  on public.client_crm_profiles (updated_by, updated_at);
create index if not exists credit_ledger_created_by_idx
  on public.credit_ledger (created_by, created_at);
create index if not exists credit_ledger_seller_idx
  on public.credit_ledger (seller_id, created_at);
create index if not exists global_permanent_access_tokens_created_by_idx
  on public.global_permanent_access_tokens (created_by, created_at);
create index if not exists password_reset_requests_approved_by_idx
  on public.password_reset_requests (approved_by, approved_at);
create index if not exists permanent_access_tokens_created_by_idx
  on public.permanent_access_tokens (created_by, created_at);
create index if not exists rbac_permission_overrides_updated_by_idx
  on public.rbac_permission_overrides (updated_by, updated_at);
create index if not exists referral_redemptions_redeemed_by_idx
  on public.referral_redemptions (redeemed_by_user_id, created_at);
create index if not exists user_roles_granted_by_idx
  on public.user_roles (granted_by, created_at);

-- Búsquedas administrativas con LIKE '%texto%'. pg_trgm ya forma parte del
-- proyecto; IF NOT EXISTS mantiene la migración segura en entornos nuevos.
create extension if not exists pg_trgm;
create index if not exists users_display_name_search_idx
  on public.users using gin (lower(display_name) gin_trgm_ops)
  where deleted_at is null;
create index if not exists users_username_search_idx
  on public.users using gin (lower(username) gin_trgm_ops)
  where deleted_at is null;
create index if not exists users_email_search_idx
  on public.users using gin (lower(email) gin_trgm_ops)
  where deleted_at is null;
create index if not exists users_telegram_search_idx
  on public.users using gin (telegram_user_id gin_trgm_ops)
  where deleted_at is null and telegram_user_id is not null;

-- El trigger de límite diario utiliza rangos de texto ISO sobre created_at.
-- Esto permite reutilizar el índice existente (user_id, created_at) sin una
-- conversión no inmutable dentro de una expresión de índice.
create index if not exists account_movements_user_created_idx
  on public.account_movements (user_id, created_at);

-- Los saldos, importes y créditos dejan de estar limitados a int4. Los valores
-- de la aplicación siguen siendo números seguros mientras permanezcan dentro
-- de los límites de negocio, pero PostgreSQL ya no desborda al crecer.
do $$
begin
  alter table public.account_balances alter column balance_cents type bigint using balance_cents::bigint;
  alter table public.account_movements alter column amount_cents type bigint using amount_cents::bigint;
  alter table public.client_crm_activities alter column amount_cents type bigint using amount_cents::bigint;
  alter table public.credit_ledger alter column delta type bigint using delta::bigint;
  alter table public.credit_ledger alter column balance_after type bigint using balance_after::bigint;
  alter table public.activations alter column credits_charged type bigint using credits_charged::bigint;
  alter table public.autocomplete_keys alter column credits_total type bigint using credits_total::bigint;
  alter table public.autocomplete_keys alter column credits_remaining type bigint using credits_remaining::bigint;
  alter table public.password_reset_requests alter column price_credits type bigint using price_credits::bigint;
  alter table public.users alter column credits type bigint using credits::bigint;
exception
  when duplicate_object then null;
end
$$;

create or replace function public.yape_daily_transfer_limit_before_movement()
returns trigger
language plpgsql
as $$
declare
  total_cents bigint;
  local_day_start timestamptz;
  local_day_end timestamptz;
  day_start_text text;
  day_end_text text;
begin
  if current_setting('yape.importing', true) = 'true' then
    return new;
  end if;
  local_day_start := date_trunc('day', new.created_at::timestamptz - interval '5 hours') + interval '5 hours';
  local_day_end := local_day_start + interval '1 day';
  day_start_text := to_char(local_day_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  day_end_text := to_char(local_day_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  select coalesce(sum(amount_cents), 0)
    into total_cents
    from public.account_movements
   where user_id = new.user_id
     and created_at >= day_start_text
     and created_at < day_end_text;
  if total_cents + new.amount_cents > 200000 then
    raise exception 'DAILY_LIMIT_EXCEEDED';
  end if;
  return new;
end;
$$;

-- Limpieza acotada de datos operativos. Los registros financieros, usuarios y
-- auditoría reciente no se eliminan. pg_cron está disponible en Supabase Pro;
-- si el proyecto lo desactiva, la aplicación sigue funcionando y el job se
-- puede ejecutar desde un cron externo autenticado.
create or replace function public.yape_operational_retention()
returns void
language plpgsql
as $$
begin
  delete from public.auth_rate_limits
   where updated_at < (now() - interval '2 days')::text;
  delete from public.sessions
   where expires_at < now()::text;
  delete from public.telegram_registration_challenges
   where expires_at < now()::text;
  delete from public.password_reset_tokens
   where expires_at < now()::text and used_at is not null;
  delete from public.qr_scan_events
   where scanned_at < (now() - interval '180 days')::text;
  delete from public.recipient_lookup_attempts
   where created_at < (now() - interval '180 days')::text;
  delete from public.telegram_updates
   where received_at < (now() - interval '30 days')::text;
  delete from public.manager_audit_log
   where created_at < (now() - interval '365 days')::text;
end;
$$;
revoke all on function public.yape_operational_retention() from public;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'yape-operational-retention') then
    perform cron.schedule(
      'yape-operational-retention',
      '15 3 * * *',
      'select public.yape_operational_retention()'
    );
  end if;
exception
  when undefined_table or undefined_function then null;
end
$$;

comment on function public.yape_operational_retention() is
  'Limpieza diaria de sesiones, rate limits y eventos operativos caducados.';
