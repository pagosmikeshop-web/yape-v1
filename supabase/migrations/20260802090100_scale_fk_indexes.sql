-- Índice faltante detectado por el asesor de Supabase para joins y borrados.
create index if not exists account_movements_saved_recipient_idx
  on public.account_movements (saved_recipient_id);
