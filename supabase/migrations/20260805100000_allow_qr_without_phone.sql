-- Los QR de otros bancos no incluyen celular. El payload cifrado y el banco
-- seleccionado son suficientes para registrarlos.
do $$
declare
  constraint_name text;
begin
  select c.conname
    into constraint_name
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = 'global_qr_directory'
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) ilike '%phone_e164 is not null%'
     and pg_get_constraintdef(c.oid) ilike '%recipient_user_id is not null%'
   limit 1;

  if constraint_name is not null then
    execute format(
      'alter table public.global_qr_directory drop constraint %I',
      constraint_name
    );
  end if;
end $$;
