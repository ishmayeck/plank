-- Known-network ranges for mod IP intelligence (Chunk 18).
--
-- The roadmap's requirement was "enrich poster IPs with ASN/org info via a
-- local lookup, no per-request external API calls". Calling an API per lookup
-- would leak every poster's address to a third party and put a network round
-- trip in the middle of a mod page.
--
-- Postgres already has everything needed: a native `cidr` type, a containment
-- operator, and a GiST index to make it fast. So the range data lives here and
-- the lookup is a local indexed query. Populating it is an OFFLINE operation
-- (scripts/load-ip-ranges.ts) reading the prefix lists that cloud providers
-- publish about themselves.
--
-- The table is empty by default and the feature degrades to structural
-- classification (private/CGNAT/loopback, which are fixed by RFC and need no
-- data at all) rather than breaking.

create table if not exists public.ip_ranges (
  id         bigserial primary key,
  network    cidr        not null,
  -- cloud | hosting | vpn | tor | proxy
  kind       text        not null,
  org        text        not null,
  source     text,
  updated_at timestamptz not null default now(),
  unique (network, org)
);

-- GiST with inet_ops is what makes `>>=` an index scan instead of a table
-- scan; without it this degrades badly once the table holds real provider
-- data, which runs to thousands of prefixes.
create index if not exists idx_ip_ranges_network
  on public.ip_ranges using gist (network inet_ops);

alter table public.ip_ranges enable row level security;
revoke all on public.ip_ranges from anon, authenticated;
revoke all on sequence public.ip_ranges_id_seq from anon, authenticated;

/**
 * Most-specific range containing p_ip, or no rows.
 *
 * Ordering by masklen descending matters: providers publish overlapping
 * prefixes (a /12 announced alongside the /16s inside it), and the narrower
 * one carries the more useful attribution.
 *
 * Returns nothing rather than raising when p_ip isn't a valid address, so a
 * malformed value in posts.poster_ip can't 500 the mod page.
 */
create or replace function public.lookup_ip_range(p_ip text)
returns table (kind text, org text, network cidr, source text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ip inet;
begin
  begin
    v_ip := p_ip::inet;
  exception when others then
    return;
  end;

  return query
    select r.kind, r.org, r.network, r.source
      from public.ip_ranges r
     where r.network >>= v_ip
     order by masklen(r.network) desc
     limit 1;
end;
$$;

revoke execute on function public.lookup_ip_range(text) from anon, authenticated;
