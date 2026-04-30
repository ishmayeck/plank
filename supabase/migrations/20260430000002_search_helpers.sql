-- Safer / more useful full-text search helpers for the search route.
--
-- The previous JS code joined whitespace-split tokens with " & " to
-- build a tsquery, which crashed on any of `&|!():<>` in the input.
-- websearch_to_tsquery accepts user input safely and supports OR /
-- quoting / NOT.
--
-- A single-shot RPC also lets us dedupe-by-topic-id in SQL (DISTINCT
-- ON) so callers don't have to fetch a paginated batch and lose rows
-- to client-side dedup.

create or replace function public.search_topics(
  p_keywords text,
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
