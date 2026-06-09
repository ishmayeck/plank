-- Public bucket for theme static assets (CSS, images, smilies) and compiled
-- template manifests (AST JSON from scripts/compile-theme.ts).
--
-- Written only by the service role (deploy scripts, future admin theme
-- upload), which bypasses RLS — so no insert/update/delete policies, just
-- public read. The Edge deployment redirects /templates/* and /images/* to
-- these objects instead of serving from a filesystem; see DEPLOYMENT.md.
insert into storage.buckets (id, name, public)
values ('theme-assets', 'theme-assets', true)
on conflict (id) do nothing;

create policy "Theme assets are publicly readable"
  on storage.objects for select
  to public
  using (bucket_id = 'theme-assets');
