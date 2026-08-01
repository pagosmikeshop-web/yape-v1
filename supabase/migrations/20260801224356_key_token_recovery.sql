-- Allows authorized panel users to re-open newly issued keys.
-- The value is AES-256-GCM ciphertext; redemption still uses token_hash.
alter table public.autocomplete_keys
  add column if not exists token_ciphertext text;

alter table public.global_permanent_access_tokens
  add column if not exists token_ciphertext text;
