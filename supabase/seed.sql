-- Seed data for Plank Forum development

-- ─── Default board config ──────────────────────────────────────
insert into public.config (config_name, config_value) values
  ('sitename', 'Plank Forum'),
  ('site_desc', 'A board. Made of plank.'),
  ('board_timezone', 'UTC'),
  ('posts_per_page', '15'),
  ('topics_per_page', '25'),
  ('allow_bbcode', '1'),
  ('allow_smilies', '1'),
  ('allow_sig', '1'),
  ('allow_avatar_upload', '1'),
  ('allow_avatar_url', '1'),
  ('require_activation', '0'),
  ('board_email', 'admin@plank.local'),
  ('default_style', 'Solaris');

-- ─── Default ranks ─────────────────────────────────────────────
insert into public.ranks (rank_title, rank_min, rank_special) values
  ('New Member', 0, false),
  ('Member', 10, false),
  ('Senior Member', 50, false),
  ('Veteran', 200, false),
  ('Site Admin', 0, true);

-- ─── Default smilies ──────────────────────────────────────────
insert into public.smilies (code, smile_url, emoticon) values
  (':)', 'icon_smile.gif', 'Smile'),
  (':-)', 'icon_smile.gif', 'Smile'),
  (':(', 'icon_sad.gif', 'Sad'),
  (':-(', 'icon_sad.gif', 'Sad'),
  (':D', 'icon_biggrin.gif', 'Very Happy'),
  (':-D', 'icon_biggrin.gif', 'Very Happy'),
  (':o', 'icon_surprised.gif', 'Surprised'),
  (':-o', 'icon_surprised.gif', 'Surprised'),
  (':?', 'icon_confused.gif', 'Confused'),
  (':-?', 'icon_confused.gif', 'Confused'),
  ('8)', 'icon_cool.gif', 'Cool'),
  ('8-)', 'icon_cool.gif', 'Cool'),
  (':lol:', 'icon_lol.gif', 'Laughing'),
  (':x', 'icon_mad.gif', 'Mad'),
  (':-x', 'icon_mad.gif', 'Mad'),
  (':P', 'icon_razz.gif', 'Razz'),
  (':-P', 'icon_razz.gif', 'Razz'),
  (':oops:', 'icon_redface.gif', 'Embarrassed'),
  (':cry:', 'icon_cry.gif', 'Crying'),
  (':evil:', 'icon_evil.gif', 'Evil or Very Mad'),
  (':twisted:', 'icon_twisted.gif', 'Twisted Evil'),
  (':roll:', 'icon_rolleyes.gif', 'Rolling Eyes'),
  (':wink:', 'icon_wink.gif', 'Wink'),
  (';)', 'icon_wink.gif', 'Wink'),
  (':!:', 'icon_exclaim.gif', 'Exclamation'),
  (':?:', 'icon_question.gif', 'Question'),
  (':idea:', 'icon_idea.gif', 'Idea'),
  (':arrow:', 'icon_arrow.gif', 'Arrow'),
  (':|', 'icon_neutral.gif', 'Neutral'),
  (':-|', 'icon_neutral.gif', 'Neutral'),
  (':mrgreen:', 'icon_mrgreen.gif', 'Mr. Green');

-- ─── Categories ────────────────────────────────────────────────
insert into public.categories (cat_title, cat_order) values
  ('General', 1),
  ('Off-Topic', 2);

-- ─── Forums ────────────────────────────────────────────────────
insert into public.forums (cat_id, forum_name, forum_desc, forum_order) values
  (1, 'Announcements', 'Site news and announcements', 1),
  (1, 'General Discussion', 'Talk about anything and everything', 2),
  (2, 'Off-Topic', 'Random chat, memes, and nonsense', 3);
