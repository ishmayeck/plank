-- Installed themes (Chunk 23: drop-in themes).
--
-- A theme is identified by the SHA-256 of the zip it came from, so the same
-- bytes always resolve to the same key and a re-upload of changed bytes is
-- automatically a different theme (and therefore an automatic cache miss).
--
-- The compiled AST manifest and the theme's assets live in the public
-- `theme-assets` bucket under themes/<hash>/; this table is the index over
-- them plus the record of which one is active.

create table if not exists public.themes (
  id           serial primary key,
  -- The name the theme calls ITSELF, taken from the archive's root directory.
  -- Load-bearing: phpBB2 templates hard-code their own asset paths as
  -- templates/<name>/images/..., so this is how those requests are served.
  theme_name   text        not null,
  theme_hash   text        not null unique,
  installed_at timestamptz not null default now(),
  is_active    boolean     not null default false
);

-- At most one active theme, enforced by the database rather than by whichever
-- handler happens to run last.
create unique index if not exists themes_one_active
  on public.themes (is_active)
  where is_active;

-- Same lockdown posture as every other table (20260609000002): RLS on, no
-- policies, no grants to anon/authenticated. All access is service-role.
alter table public.themes enable row level security;
revoke all on public.themes from anon, authenticated;
revoke all on sequence public.themes_id_seq from anon, authenticated;
