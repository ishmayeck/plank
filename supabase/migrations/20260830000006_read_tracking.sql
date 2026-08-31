-- Per-user read tracking (Chunk 18).
--
-- The folder icons on the index and topic lists have always rendered
-- "no new posts" unconditionally, and /markread was a redirect with a comment
-- saying a real implementation would update a tracking table. This is that
-- table.
--
-- Three watermarks, checked most-specific first. A topic is unread when its
-- last post is newer than ALL of:
--
--   topics_read   this user read this specific topic
--   forums_read   this user marked this whole forum read
--   profiles.user_lastmark   this user marked the entire board read
--
-- phpBB2 2.0 kept this in a cookie, which capped how many topics it could
-- remember and lost everything on a new device. A table costs one indexed
-- query per page and works across devices, which is the tradeoff worth making
-- now that storage is not measured in kilobytes.

create table if not exists public.topics_read (
  user_id   uuid        not null references public.profiles(id) on delete cascade,
  topic_id  integer     not null references public.topics(id) on delete cascade,
  read_time timestamptz not null default now(),
  primary key (user_id, topic_id)
);

-- The lookup is always "this user's rows for these topics".
create index if not exists idx_topics_read_user on public.topics_read(user_id);

create table if not exists public.forums_read (
  user_id   uuid        not null references public.profiles(id) on delete cascade,
  forum_id  integer     not null references public.forums(id) on delete cascade,
  read_time timestamptz not null default now(),
  primary key (user_id, forum_id)
);

create index if not exists idx_forums_read_user on public.forums_read(user_id);

-- "Mark all forums read" — one column beats writing a row per forum, and it
-- keeps working for forums created after the user clicked it.
alter table public.profiles
  add column if not exists user_lastmark timestamptz;

comment on column public.profiles.user_lastmark is
  'When the user last marked the whole board read. Anything older is read.';

-- Same lockdown posture as every other table (20260609000002).
alter table public.topics_read enable row level security;
alter table public.forums_read enable row level security;
revoke all on public.topics_read from anon, authenticated;
revoke all on public.forums_read from anon, authenticated;

-- Housekeeping: once the whole board has been marked read, the per-topic and
-- per-forum rows older than that watermark can never change an answer, so
-- they are dead weight. Called opportunistically from markAllRead().
create or replace function public.prune_read_rows(p_user_id uuid, p_before timestamptz)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.topics_read where user_id = p_user_id and read_time <= p_before;
  delete from public.forums_read where user_id = p_user_id and read_time <= p_before;
$$;

revoke execute on function public.prune_read_rows(uuid, timestamptz) from anon, authenticated;
