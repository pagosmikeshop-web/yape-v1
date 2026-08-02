-- La retención se ejecuta desde Vercel Cron. Supabase puede no tener
-- pg_cron habilitado, por lo que nunca debemos resolver cron.job cuando la
-- extensión no existe: una expresión AND no garantiza cortocircuito en SQL.
-- Esta migración es idempotente y no modifica datos de negocio.
do $$
begin
  if exists (
    select 1
      from pg_extension
     where extname = 'pg_cron'
  ) then
    begin
      if not exists (
        select 1
          from cron.job
         where jobname = 'yape-operational-retention'
      ) then
        perform cron.schedule(
          'yape-operational-retention',
          '15 3 * * *',
          'select public.yape_operational_retention()'
        );
      end if;
    exception
      when undefined_table or undefined_function then
        -- El mantenimiento principal vive en Vercel Cron. Si pg_cron no está
        -- instalado o no expone sus catálogos, no bloqueamos el despliegue.
        null;
    end;
  end if;
end
$$;
