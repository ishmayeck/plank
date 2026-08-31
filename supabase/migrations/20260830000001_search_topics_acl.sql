-- search_topics must not range over forums the caller cannot read.
--
-- The original signature took only keywords/forum/since/limit/offset and
-- searched every post in the database. Authorization in Plank is app-level
-- (src/lib/permissions.ts) and the app queries with the service-role client,
-- so nothing else was going to stop it: /search returned post bodies and
-- topic titles from private forums to anonymous visitors.
--
-- p_forum_ids is deliberately REQUIRED (no default). A future caller that
-- forgets it gets a hard "function does not exist" from Postgres rather than
-- silently searching the whole board — the same fail-loud rule canDo() now
-- applies to unselected auth columns. Pass the result of
-- loadAccessibleForumIds(); an empty array correctly matches nothing.

drop function if exists public.search_topics(text, integer, timestamptz, integer, integer);

create or replace function public.search_topics(
  p_keywords text,
  p_forum_ids integer[],
  p_forum_id integer default null,
  p_since timestamptz default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  out_topic_id integer,
  out_match_post_time timestamptz,
  out_total_count bigint
)
language plpgsql
as $$
begin
  return query
  with matches as (
    select
      p.topic_id as t_id,
      p.post_time as t_post_time,
      row_number() over (partition by p.topic_id order by p.post_time desc) as rn
    from public.posts p
    join public.posts_text pt on pt.post_id = p.id
    where
      (p_keywords is null or p_keywords = '' or pt.search_vector @@ websearch_to_tsquery('english', p_keywords))
      and (p_forum_id is null or p_forum_id = 0 or p.forum_id = p_forum_id)
      and (p_since is null or p.post_time >= p_since)
      -- The ACL gate. Not optional, not nullable-to-skip.
      and p.forum_id = any(p_forum_ids)
  ),
  unique_topics as (
    select t_id, t_post_time from matches where rn = 1
  ),
  total as (
    select count(*) as c from unique_topics
  )
  select ut.t_id, ut.t_post_time, t.c
  from unique_topics ut cross join total t
  order by ut.t_post_time desc
  limit p_limit
  offset p_offset;
end;
$$;

revoke execute on function public.search_topics(text, integer[], integer, timestamptz, integer, integer)
  from anon, authenticated;
