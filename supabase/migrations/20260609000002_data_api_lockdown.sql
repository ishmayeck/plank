-- Data API lockdown (DEPLOYMENT.md step 6).
--
-- Plank's authorization is app-level (src/lib/permissions.ts) and every
-- data access goes through the service-role client; the anon/authenticated
-- PostgREST roles are not used for table access at all. Lock them out so a
-- leaked anon key (publishable by Supabase convention) exposes nothing —
-- previously it could read the entire database, including private_messages
-- and poster IPs, via the public REST endpoint.
--
-- The service role has BYPASSRLS, so the app is unaffected. Verified by the
-- full test suite after a local reset and a live smoke test.

-- Enable RLS on every public table: satisfies the dashboard security
-- advisor, and with no policies defined this denies anon/authenticated by
-- default. Dynamic so it covers all current tables without a hand-kept list.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Belt and braces: also revoke the PostgREST grants, so a probing request
-- fails loudly with "permission denied" instead of returning a confusing
-- empty result set (RLS-with-no-policies filters rather than errors).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated;

-- And make sure future tables/functions created by migrations don't get
-- the default grants back.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
