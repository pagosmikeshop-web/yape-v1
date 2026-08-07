-- El saldo configurable de una cuenta no puede superar S/ 1,000,000.00.
-- La comprobación previa evita que una migración sobre datos existentes
-- falle con un error de restricción poco descriptivo.
begin;

do $$
begin
  if exists (
    select 1
      from public.account_balances
     where balance_cents > 100000000
  ) then
    raise exception
      using message = 'ACCOUNT_BALANCE_LIMIT_MIGRATION_BLOCKED: existen saldos superiores a S/ 1,000,000.00';
  end if;
end
$$;

alter table public.account_balances
  drop constraint if exists account_balances_maximum_check;

alter table public.account_balances
  add constraint account_balances_maximum_check
  check (balance_cents >= 0 and balance_cents <= 100000000);

commit;
