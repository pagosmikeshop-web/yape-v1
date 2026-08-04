-- Defense in depth for the private server-side database architecture.
-- The application connects with the server-only postgres role; the browser
-- must not receive table privileges through Supabase's Data API roles.
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on all functions in schema public from anon, authenticated;

alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges in schema public
  revoke all on functions from anon, authenticated;

comment on schema public is
  'Application data is accessed only by the server-side postgres role; Data API roles have no direct privileges.';
