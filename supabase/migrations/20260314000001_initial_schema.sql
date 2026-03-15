-- Plank Forum: Core schema
-- Modeled after phpBB2 but using Supabase Auth for user management

-- ─── User Profiles ─────────────────────────────────────────────
-- Extends Supabase auth.users with forum-specific profile data
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  user_active boolean not null default true,
  user_level smallint not null default 0, -- 0=user, 1=admin, 2=mod
  user_posts integer not null default 0,
  user_regdate timestamptz not null default now(),
  user_lastvisit timestamptz,
  user_timezone text not null default 'UTC',
  user_dateformat text not null default 'DD Mon YYYY HH24:MI',
  user_avatar text,
  user_avatar_type smallint not null default 0, -- 0=none, 1=upload, 2=url, 3=gallery
  user_sig text,
  user_from text,
  user_website text,
  user_occ text,
  user_interests text,
  user_viewemail boolean not null default false,
  user_attachsig boolean not null default true,
  user_allow_pm boolean not null default true,
  user_allow_viewonline boolean not null default true,
  user_notify boolean not null default true,
  user_rank integer default 0
);

create index idx_profiles_username on public.profiles(username);
create index idx_profiles_posts on public.profiles(user_posts);

-- ─── Categories ────────────────────────────────────────────────
create table public.categories (
  id serial primary key,
  cat_title text not null,
  cat_order integer not null default 0
);

create index idx_categories_order on public.categories(cat_order);

-- ─── Forums ────────────────────────────────────────────────────
create table public.forums (
  id serial primary key,
  cat_id integer not null references public.categories(id) on delete cascade,
  forum_name text not null,
  forum_desc text,
  forum_status smallint not null default 0, -- 0=open, 1=locked
  forum_order integer not null default 0,
  forum_posts integer not null default 0,
  forum_topics integer not null default 0,
  forum_last_post_id integer,
  -- Auth levels: 0=ALL, 1=REG, 2=ACL, 3=MOD, 5=ADMIN
  auth_view smallint not null default 0,
  auth_read smallint not null default 0,
  auth_post smallint not null default 1,
  auth_reply smallint not null default 1,
  auth_edit smallint not null default 1,
  auth_delete smallint not null default 1,
  auth_sticky smallint not null default 3,
  auth_announce smallint not null default 3,
  auth_vote smallint not null default 1,
  auth_pollcreate smallint not null default 1
);

create index idx_forums_cat on public.forums(cat_id);
create index idx_forums_order on public.forums(forum_order);

-- ─── Topics ────────────────────────────────────────────────────
create table public.topics (
  id serial primary key,
  forum_id integer not null references public.forums(id) on delete cascade,
  topic_title text not null,
  topic_poster uuid not null references public.profiles(id),
  topic_time timestamptz not null default now(),
  topic_views integer not null default 0,
  topic_replies integer not null default 0,
  topic_status smallint not null default 0, -- 0=open, 1=locked, 2=moved
  topic_type smallint not null default 0,   -- 0=normal, 1=sticky, 2=announce, 3=global
  topic_vote boolean not null default false,
  topic_first_post_id integer,
  topic_last_post_id integer,
  topic_moved_id integer default 0
);

create index idx_topics_forum on public.topics(forum_id);
create index idx_topics_type on public.topics(topic_type);
create index idx_topics_last_post on public.topics(topic_last_post_id);
create index idx_topics_poster on public.topics(topic_poster);

-- ─── Posts ──────────────────────────────────────────────────────
create table public.posts (
  id serial primary key,
  topic_id integer not null references public.topics(id) on delete cascade,
  forum_id integer not null references public.forums(id) on delete cascade,
  poster_id uuid not null references public.profiles(id),
  post_time timestamptz not null default now(),
  poster_ip inet,
  post_username text, -- for guest posts or deleted user display
  enable_bbcode boolean not null default true,
  enable_smilies boolean not null default true,
  enable_sig boolean not null default true,
  post_edit_time timestamptz,
  post_edit_count smallint not null default 0
);

create index idx_posts_topic on public.posts(topic_id);
create index idx_posts_forum on public.posts(forum_id);
create index idx_posts_poster on public.posts(poster_id);
create index idx_posts_time on public.posts(post_time);

-- ─── Post Text ─────────────────────────────────────────────────
-- Separate table like phpBB2, keeps post metadata queries fast
create table public.posts_text (
  post_id integer primary key references public.posts(id) on delete cascade,
  post_subject text,
  post_text text not null,
  -- Pre-rendered HTML for display (BBCode → HTML done at write time)
  post_text_html text
);

-- Full-text search index
alter table public.posts_text add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(post_subject, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(post_text, '')), 'B')
  ) stored;

create index idx_posts_text_search on public.posts_text using gin(search_vector);

-- ─── Private Messages ──────────────────────────────────────────
create table public.privmsgs (
  id serial primary key,
  privmsgs_type smallint not null default 0,
  -- types: 0=not read, 1=read, 2=new, 3=sent, 4=saved_in, 5=saved_out
  privmsgs_subject text not null,
  privmsgs_from_userid uuid not null references public.profiles(id),
  privmsgs_to_userid uuid not null references public.profiles(id),
  privmsgs_date timestamptz not null default now(),
  privmsgs_ip inet,
  privmsgs_enable_bbcode boolean not null default true,
  privmsgs_enable_smilies boolean not null default true,
  privmsgs_attach_sig boolean not null default true
);

create index idx_privmsgs_to on public.privmsgs(privmsgs_to_userid);
create index idx_privmsgs_from on public.privmsgs(privmsgs_from_userid);

create table public.privmsgs_text (
  privmsgs_text_id integer primary key references public.privmsgs(id) on delete cascade,
  privmsgs_text text not null,
  privmsgs_text_html text
);

-- ─── Groups ────────────────────────────────────────────────────
create table public.groups (
  id serial primary key,
  group_type smallint not null default 1, -- 0=open, 1=closed, 2=hidden
  group_name text not null,
  group_description text not null default '',
  group_moderator uuid references public.profiles(id),
  group_single_user boolean not null default false
);

create table public.user_group (
  group_id integer not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_pending boolean not null default false,
  primary key (group_id, user_id)
);

-- ─── Auth Access (group-based forum permissions) ───────────────
create table public.auth_access (
  group_id integer not null references public.groups(id) on delete cascade,
  forum_id integer not null references public.forums(id) on delete cascade,
  auth_view boolean not null default false,
  auth_read boolean not null default false,
  auth_post boolean not null default false,
  auth_reply boolean not null default false,
  auth_edit boolean not null default false,
  auth_delete boolean not null default false,
  auth_sticky boolean not null default false,
  auth_announce boolean not null default false,
  auth_vote boolean not null default false,
  auth_pollcreate boolean not null default false,
  auth_mod boolean not null default false,
  primary key (group_id, forum_id)
);

-- ─── Polls ─────────────────────────────────────────────────────
create table public.poll_questions (
  id serial primary key,
  topic_id integer not null references public.topics(id) on delete cascade,
  poll_text text not null,
  poll_start timestamptz not null default now(),
  poll_length interval default null -- null = no expiry
);

create index idx_poll_topic on public.poll_questions(topic_id);

create table public.poll_options (
  id serial primary key,
  poll_id integer not null references public.poll_questions(id) on delete cascade,
  option_text text not null,
  option_order smallint not null default 0,
  vote_count integer not null default 0
);

create table public.poll_votes (
  poll_id integer not null references public.poll_questions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  option_id integer not null references public.poll_options(id) on delete cascade,
  primary key (poll_id, user_id)
);

-- ─── Topic Watching ────────────────────────────────────────────
create table public.topics_watch (
  topic_id integer not null references public.topics(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  notify_status boolean not null default false,
  primary key (topic_id, user_id)
);

-- ─── Bans ──────────────────────────────────────────────────────
create table public.banlist (
  id serial primary key,
  ban_userid uuid references public.profiles(id) on delete cascade,
  ban_email text,
  ban_reason text,
  ban_start timestamptz not null default now(),
  ban_end timestamptz -- null = permanent
);

-- ─── Ranks ─────────────────────────────────────────────────────
create table public.ranks (
  id serial primary key,
  rank_title text not null,
  rank_min integer not null default 0, -- minimum post count for auto-rank
  rank_special boolean not null default false, -- manually assigned ranks
  rank_image text
);

-- ─── Smilies ───────────────────────────────────────────────────
create table public.smilies (
  id serial primary key,
  code text not null,
  smile_url text not null,
  emoticon text not null
);

-- ─── Word Censors ──────────────────────────────────────────────
create table public.word_censors (
  id serial primary key,
  word text not null,
  replacement text not null
);

-- ─── Board Config ──────────────────────────────────────────────
create table public.config (
  config_name text primary key,
  config_value text not null
);

-- ─── Online Sessions (for "who's online") ─────────────────────
create table public.sessions (
  session_id text primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  session_start timestamptz not null default now(),
  session_time timestamptz not null default now(),
  session_ip inet,
  session_page text,
  session_logged_in boolean not null default false
);

create index idx_sessions_user on public.sessions(user_id);
create index idx_sessions_time on public.sessions(session_time);

-- ─── Disallowed Usernames ─────────────────────────────────────
create table public.disallowed_usernames (
  id serial primary key,
  pattern text not null -- supports wildcards
);

-- ─── Add foreign key for forum_last_post_id ───────────────────
-- (deferred because posts table must exist first)
alter table public.forums
  add constraint fk_forums_last_post
  foreign key (forum_last_post_id) references public.posts(id)
  on delete set null;

alter table public.topics
  add constraint fk_topics_first_post
  foreign key (topic_first_post_id) references public.posts(id)
  on delete set null;

alter table public.topics
  add constraint fk_topics_last_post
  foreign key (topic_last_post_id) references public.posts(id)
  on delete set null;
