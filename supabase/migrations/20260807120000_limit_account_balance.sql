-- El saldo configurable de una cuenta no puede superar S/ 1,000,000.00.
-- La restricción se agrega como NOT VALID para conservar saldos históricos
-- que ya superen el límite sin recortarlos ni eliminarlos. PostgreSQL la
-- aplicará a toda inserción o actualización posterior.
begin;

alter table public.account_balances
  drop constraint if exists account_balances_balance_cents_check;
alter table public.account_balances
  drop constraint if exists account_balances_maximum_check;

alter table public.account_balances
  add constraint account_balances_maximum_check
  check (balance_cents >= 0 and balance_cents <= 100000000)
  not valid;

commit;
