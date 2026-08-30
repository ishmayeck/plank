-- Two hardening items from the August 2026 security review.
--
-- 1. Avatar bucket policies were scoped to a literal path prefix, not to the
--    owner.
--
--    The original policies checked `(storage.foldername(name))[1] = 'avatars'`
--    and were named "Users can upload/update/delete their OWN avatar" — but
--    that condition contains no reference to auth.uid() at all. Objects are
--    stored at `avatars/<uid>.<ext>` (src/routes/profile.ts), so every user's
--    avatar matched every user's policy: any authenticated member could
--    overwrite or delete anyone else's avatar, or upload arbitrary files into
--    a public bucket.
--
--    The Data API lockdown (20260609000002) did not cover this. It revoked
--    grants in schema `public`; storage.objects lives in schema `storage`, and
--    Storage is a separate API authenticated with the user's own JWT — which a
--    logged-in user can read straight out of their browser.
--
--    Rather than rewrite the policies to compare auth.uid(), drop them. Plank
--    uploads avatars through the service-role client (which bypasses RLS), so
--    the `authenticated` role never needs write access to this bucket at all.
--    Least privilege, and it can't drift out of sync with the app's path
--    convention the way an auth.uid() comparison could.
--
-- 2. check_rate_limit is SECURITY DEFINER with an unpinned search_path.

drop policy if exists "Users can upload their own avatar" on storage.objects;
drop policy if exists "Users can update their own avatar" on storage.objects;
drop policy if exists "Users can delete their own avatar" on storage.objects;

-- Public read stays: avatars are displayed to everyone, and the bucket is
-- public by design. (Policy left in place, not recreated, so this migration is
-- safe to re-run.)

-- Belt and braces: cap what can be stored even if a write path is ever opened
-- up again. The app already validates type and dimensions, but the app is not
-- the only thing that can reach Storage.
update storage.buckets
   set file_size_limit = 6291456,  -- 6 MB, matching avatar_filesize default
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/gif']
 where id = 'avatars';

-- A SECURITY DEFINER function without a pinned search_path resolves unqualified
-- names using the CALLER's search_path, which is the classic route to running
-- attacker-controlled code as the definer. Exploitability here is low — execute
-- was revoked from anon/authenticated in 20260609000002, so only the service
-- role can call it — but it is a standard hardening item and Supabase's linter
-- flags it.
alter function public.check_rate_limit(text, integer, integer)
  set search_path = public, pg_temp;
