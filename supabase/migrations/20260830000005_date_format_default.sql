-- Correct the date-format default to the syntax we actually interpret.
--
-- profiles.user_dateformat defaulted to 'DD Mon YYYY HH24:MI', which is
-- Postgres/Oracle formatting syntax — but the registration form has always
-- told users "the syntax used is identical to the PHP date() function", and
-- phpBB2 (whose data this schema is shaped to accept) stored PHP date()
-- strings. Nothing ever read the column, so the mismatch was invisible.
--
-- Now that Chunk 20 interprets it, the wrong syntax would render literally:
-- 'DD Mon YYYY HH24:MI' would come out as something like
-- "3131 Mon 20262026 1524:45" — every unrecognised letter passing through
-- while D, M, Y and H got substituted.

alter table public.profiles
  alter column user_dateformat set default 'D M d, Y g:i a';

-- Migrate rows still carrying the old default. Deliberately scoped to that
-- exact string: anyone who has typed their own format keeps it.
update public.profiles
   set user_dateformat = 'D M d, Y g:i a'
 where user_dateformat = 'DD Mon YYYY HH24:MI';
