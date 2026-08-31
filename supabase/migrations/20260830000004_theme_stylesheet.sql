-- Record each theme's own stylesheet filename.
--
-- phpBB2 themes name their stylesheet after themselves — Solaris.css,
-- subSilver.css — and overall_header.tpl links it as
-- `templates/<Name>/{T_HEAD_STYLESHEET}`. Plank hardcoded that variable to
-- "Solaris.css", so activating any other theme produced a correctly-rendered
-- but completely unstyled board: the templates switched, the CSS did not.
--
-- Detected at install from the archive's top-level .css, so we use what the
-- theme actually ships rather than assuming the convention holds.

alter table public.themes
  add column if not exists theme_stylesheet text;

comment on column public.themes.theme_stylesheet is
  'Filename of the theme''s top-level stylesheet, e.g. "Solaris.css". Fed to the T_HEAD_STYLESHEET template variable.';
