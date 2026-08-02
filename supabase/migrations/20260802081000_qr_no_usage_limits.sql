-- Los QR globales pueden validarse todas las veces que sea necesario.
-- Se eliminan las columnas de consumo que ya no forman parte del contrato.

alter table public.global_qr_directory
  drop constraint if exists global_qr_directory_usage_check,
  drop constraint if exists global_qr_directory_single_use_check;

alter table public.global_qr_directory
  drop column if exists max_uses,
  drop column if exists usage_count,
  drop column if exists single_use,
  drop column if exists last_used_at;
