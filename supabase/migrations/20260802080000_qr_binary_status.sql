-- El lector solo expone dos resultados: QR válido o QR inválido.
-- Los estados históricos más detallados se conservan como inválidos para no
-- mostrar información innecesaria al usuario.

update public.qr_scan_events
set scan_status = 'invalid'
where scan_status not in ('valid', 'invalid');

alter table public.qr_scan_events
  drop constraint if exists qr_scan_events_scan_status_check;

alter table public.qr_scan_events
  add constraint qr_scan_events_scan_status_check
  check (scan_status in ('valid', 'invalid'));
