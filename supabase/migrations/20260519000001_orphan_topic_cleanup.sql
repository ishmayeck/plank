-- Delete a topic automatically when its last post is removed.
--
-- The schema allows topics.topic_first_post_id to be NULL, so a topic
-- can technically exist without any posts. That state is unreachable
-- in the UI (viewforum filters require a last post, viewtopic crashes
-- on an empty topic) and only ever appears as a leftover from earlier
-- code paths that deleted posts without going through the topic-delete
-- path. We extend posts_after_delete to clean that up at the source so
-- the schema can no longer host orphan topics — regardless of how the
-- last post was removed (handler, modcp, hand-rolled SQL).
--
-- Safe against re-entry: deleting the topic CASCADEs to public.posts,
-- but by the time we reach the DELETE there are no posts left on the
-- topic, so the cascade is a no-op and we don't re-enter the trigger.

create or replace function public.posts_after_delete() returns trigger
language plpgsql as $$
declare
  v_new_last_id integer;
  v_remaining   integer;
begin
  update public.forums
     set forum_posts = greatest(0, forum_posts - 1)
   where id = old.forum_id;
  update public.topics
     set topic_replies = greatest(0, topic_replies - 1)
   where id = old.topic_id;
  update public.profiles
     set user_posts = greatest(0, user_posts - 1)
   where id = old.poster_id;

  -- Recompute the topic's first/last post pointers if we removed one
  -- of them.
  update public.topics
     set topic_last_post_id = (
           select id from public.posts
            where topic_id = old.topic_id
            order by post_time desc, id desc
            limit 1
         )
   where id = old.topic_id and topic_last_post_id = old.id;
  update public.topics
     set topic_first_post_id = (
           select id from public.posts
            where topic_id = old.topic_id
            order by post_time asc, id asc
            limit 1
         )
   where id = old.topic_id and topic_first_post_id = old.id;

  -- If the topic has no posts left, it's an orphan — remove it. The
  -- topics_after_delete trigger keeps forum_topics in sync; the FK
  -- cascade from posts.topic_id has nothing to do (we just deleted
  -- the last post).
  select count(*) into v_remaining from public.posts where topic_id = old.topic_id;
  if v_remaining = 0 then
    delete from public.topics where id = old.topic_id;
  end if;

  -- Keep the forum's last-post pointer consistent.
  if exists (select 1 from public.forums where id = old.forum_id and forum_last_post_id = old.id) then
    select id into v_new_last_id from public.posts
      where forum_id = old.forum_id
      order by post_time desc, id desc
      limit 1;
    update public.forums set forum_last_post_id = v_new_last_id where id = old.forum_id;
  end if;

  return old;
end;
$$;

-- One-time cleanup of any existing orphans the prior code paths left
-- behind. Idempotent on re-run.
delete from public.topics t
 where not exists (select 1 from public.posts p where p.topic_id = t.id);
