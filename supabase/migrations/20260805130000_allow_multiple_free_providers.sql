-- Permite guardar más de una app o banco para el mismo celular.
-- Yape se prioriza en la consulta; los demás proveedores quedan disponibles
-- desde "Otros bancos".
drop index if exists public.global_recipient_directory_phone_unique;

create unique index if not exists global_recipient_directory_phone_provider_unique
  on public.global_recipient_directory (phone_e164, provider);
