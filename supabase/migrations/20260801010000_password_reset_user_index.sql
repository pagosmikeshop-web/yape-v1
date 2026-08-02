create index if not exists password_reset_user_idx
  on public.password_reset_requests (user_id, status, created_at);
