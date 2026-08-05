-- Conserva el banco/app elegido para los registros de Autocompletado Free.
alter table public.global_recipient_directory
  add column if not exists provider text not null default 'Yape';

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'global_recipient_directory'
      and c.conname = 'global_recipient_directory_provider_check'
  ) then
    alter table public.global_recipient_directory
      add constraint global_recipient_directory_provider_check
      check (provider in ('Yape', 'Plin', 'BCP', 'BBVA', 'Interbank', 'Scotiabank', 'Bim', 'Banco Falabella', 'Banco Pichincha', 'Dale!', 'Izipay', 'Agora / Oh!', 'Tunki'));
  end if;
end $$;
