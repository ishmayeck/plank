-- Atomic counter maintenance for Plank.
--
-- Counters that previously rode on read-then-write JS code (and raced
-- under concurrent posting) are now derived by triggers from the
-- source-of-truth tables. Counters that fire per-request without a
-- backing row (topic views, poll votes) get atomic-increment RPC
-- functions instead.

-- ─── Forum / topic / user post counters via triggers ─────────────

create or replace function public.posts_after_insert() returns trigger
language plpgsql as $$
begin
  update public.forums
     set forum_posts = forum_posts + 1,
         forum_last_post_id = new.id
   where id = new.forum_id;
  -- topic_replies counts replies, not the first post — phpBB convention.
  -- Atomic case-when distinguishes "this is the first post" from "this is
  -- a reply" using the existing topic_first_post_id, which was either
  -- set by a prior insert or is null on the topic-creation insert.
  update public.topics
     set topic_replies = case when topic_first_post_id is null then topic_replies else topic_replies + 1 end,
         topic_last_post_id = new.id,
         topic_first_post_id = coalesce(topic_first_post_id, new.id)
   where id = new.topic_id;
  update public.profiles
     set user_posts = user_posts + 1
   where id = new.poster_id;
  return new;
end;
$$;

create or replace function public.posts_after_delete() returns trigger
language plpgsql as $$
declare
  v_new_last_id integer;
begin
  -- Forum/topic/user post counts can't go negative.
  update public.forums
     set forum_posts = greatest(0, forum_posts - 1)
   where id = old.forum_id;
  update public.topics
     set topic_replies = greatest(0, topic_replies - 1)
   where id = old.topic_id;
  update public.profiles
     set user_posts = greatest(0, user_posts - 1)
   where id = old.poster_id;

  -- If we removed the topic's recorded last/first post, recompute.
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

  -- Same for the forum's recorded last post.
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

-- A post moving between topics/forums (modcp split/move) is updated in
-- place. Detect the change and adjust counters on both sides.
create or replace function public.posts_after_update() returns trigger
language plpgsql as $$
begin
  if old.forum_id <> new.forum_id then
    update public.forums set forum_posts = greatest(0, forum_posts - 1) where id = old.forum_id;
    update public.forums set forum_posts = forum_posts + 1 where id = new.forum_id;
  end if;
  if old.topic_id <> new.topic_id then
    update public.topics set topic_replies = greatest(0, topic_replies - 1) where id = old.topic_id;
    update public.topics set topic_replies = topic_replies + 1 where id = new.topic_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_posts_after_insert on public.posts;
drop trigger if exists trg_posts_after_delete on public.posts;
drop trigger if exists trg_posts_after_update on public.posts;

create trigger trg_posts_after_insert
  after insert on public.posts
  for each row execute function public.posts_after_insert();

create trigger trg_posts_after_delete
  after delete on public.posts
  for each row execute function public.posts_after_delete();

create trigger trg_posts_after_update
  after update of forum_id, topic_id on public.posts
  for each row execute function public.posts_after_update();

-- ─── Topic counter on the forums row ─────────────────────────────

create or replace function public.topics_after_insert() returns trigger
language plpgsql as $$
begin
  update public.forums set forum_topics = forum_topics + 1 where id = new.forum_id;
  return new;
end;
$$;

create or replace function public.topics_after_delete() returns trigger
language plpgsql as $$
begin
  update public.forums set forum_topics = greatest(0, forum_topics - 1) where id = old.forum_id;
  return old;
end;
$$;

create or replace function public.topics_after_update() returns trigger
language plpgsql as $$
begin
  if old.forum_id <> new.forum_id then
    update public.forums set forum_topics = greatest(0, forum_topics - 1) where id = old.forum_id;
    update public.forums set forum_topics = forum_topics + 1 where id = new.forum_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_topics_after_insert on public.topics;
drop trigger if exists trg_topics_after_delete on public.topics;
drop trigger if exists trg_topics_after_update on public.topics;

create trigger trg_topics_after_insert
  after insert on public.topics
  for each row execute function public.topics_after_insert();

create trigger trg_topics_after_delete
  after delete on public.topics
  for each row execute function public.topics_after_delete();

create trigger trg_topics_after_update
  after update of forum_id on public.topics
  for each row execute function public.topics_after_update();

-- ─── Atomic increments for view + vote counts ────────────────────

create or replace function public.increment_topic_views(p_topic_id integer)
returns void language sql as $$
  update public.topics set topic_views = topic_views + 1 where id = p_topic_id;
$$;

create or replace function public.increment_poll_vote(p_option_id integer)
returns void language sql as $$
  update public.poll_options set vote_count = vote_count + 1 where id = p_option_id;
$$;

-- ─── Backfill existing rows so counts match reality ──────────────

update public.forums f set
  forum_posts = (select count(*) from public.posts where forum_id = f.id),
  forum_topics = (select count(*) from public.topics where forum_id = f.id),
  forum_last_post_id = (
    select id from public.posts where forum_id = f.id
    order by post_time desc, id desc limit 1
  );

update public.topics t set
  topic_replies = greatest(0, (select count(*) from public.posts where topic_id = t.id) - 1),
  topic_first_post_id = (
    select id from public.posts where topic_id = t.id
    order by post_time asc, id asc limit 1
  ),
  topic_last_post_id = (
    select id from public.posts where topic_id = t.id
    order by post_time desc, id desc limit 1
  );

update public.profiles p set
  user_posts = (select count(*) from public.posts where poster_id = p.id);
