-- Rate limiting (Chunk 20).
--
-- Postgres-backed rather than in-process because the deployment target is
-- Supabase Edge Functions: many short-lived isolates, no shared memory, no
-- guarantee a given client hits the same instance. A DB table is the only
-- store all instances agree on, and it survives restarts. The check is a
-- single atomic RPC (fixed-window counter) so we never read-then-write from
-- JS — the same rule that motivated the atomic_counters migration.

create table if not exists public.rate_limits (
  -- Opaque bucket key, e.g. "login:ip:1.2.3.4" or "login:user:alice".
  bucket_key   text   not null,
  -- Epoch seconds of the start of the fixed window this row counts.
  window_start bigint not null,
  count        integer not null default 0,
  primary key (bucket_key, window_start)
);

-- Lookups/cleanup by age.
create index if not exists idx_rate_limits_window on public.rate_limits(window_start);

-- Only the service role touches this table; deny everyone else. (The app
-- always calls the RPC below via the service-role client, which bypasses RLS.)
alter table public.rate_limits enable row level security;

/**
 * Atomically register one hit against `p_key` and report whether the caller
 * is over the limit for the current fixed window.
 *
 * Fixed-window counter: the window is [floor(now/W)*W, +W). We upsert-
 * increment the counter for the current window and compare to the limit.
 * Slightly bursty at window edges (worst case ~2x limit across a boundary),
 * which is fine for abuse mitigation and far simpler/cheaper than a sliding
 * log. Old windows for the same key are opportunistically pruned.
 *
 * Returns:
 *   allowed      — true if this hit is within the limit
 *   current_count — hits recorded in the current window (including this one)
 *   retry_after  — seconds until the current window ends (for Retry-After)
 */
create or replace function public.check_rate_limit(
  p_key text,
  p_window_seconds integer,
  p_limit integer
)
returns table(allowed boolean, current_count integer, retry_after integer)
as $$
declare
  v_now    bigint := floor(extract(epoch from now()))::bigint;
  v_start  bigint := (v_now / p_window_seconds) * p_window_seconds;
  v_count  integer;
begin
  -- Prune stale windows for this key so the table can't grow unbounded.
  delete from public.rate_limits
   where bucket_key = p_key and window_start < v_start;

  insert into public.rate_limits (bucket_key, window_start, count)
  values (p_key, v_start, 1)
  on conflict (bucket_key, window_start)
  do update set count = public.rate_limits.count + 1
  returning count into v_count;

  return query select
    (v_count <= p_limit) as allowed,
    v_count              as current_count,
    (v_start + p_window_seconds - v_now)::integer as retry_after;
end;
$$ language plpgsql security definer;
