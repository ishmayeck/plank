# Plank — Implementation Roadmap

Each chunk is designed to be implementable in one session with tests written first.
Chunks are ordered by dependency — each builds on the previous.

---

## Chunk 1: Project Scaffolding & Template Engine ✅

**Goal**: Working Hono app that can render a phpBB2 .tpl file with injected data.

- [x] Initialize TypeScript project (package.json, tsconfig, vitest config)
- [x] Install dependencies (hono, @supabase/supabase-js, vitest)
- [x] Implement phpBB2 template engine as standalone module:
  - Variable substitution: `{VAR_NAME}` → value from data context
  - Namespaced variables: `{block.VAR}` → value from block iteration context
  - Block loops: `<!-- BEGIN name -->` / `<!-- END name -->` with array iteration
  - Nested blocks: `<!-- BEGIN catrow --><!-- BEGIN forumrow -->` with dot-scoped vars
  - Conditional switches: `<!-- BEGIN switch_x -->` / `<!-- END switch_x -->` (render if truthy)
  - Include support: loading .tpl files from a theme root directory
- [x] Hono app entry point with one test route that renders a .tpl file
- [x] Static file serving for theme assets (CSS, images)
- [x] Verify: render Solaris `overall_header.tpl` + `overall_footer.tpl` with dummy data

**Tests**: Template engine unit tests covering all constructs, edge cases (empty blocks, missing vars, nested blocks 3 levels deep).

---

## Chunk 2: Database Schema & Supabase Setup ✅

**Goal**: Supabase local dev environment with core schema matching phpBB2's data model.

- [x] Supabase local project init (`supabase init`, update docker-compose)
- [x] Core migrations:
  - users (extends Supabase auth.users with profile fields: avatar, signature, rank, location, website, occupation, interests, post_count, join_date, timezone)
  - categories (id, title, display_order)
  - forums (id, category_id, name, description, display_order, topic_count, post_count, last_post_id)
  - topics (id, forum_id, title, author_id, created_at, reply_count, view_count, type [normal/sticky/announcement/global], status [open/locked/moved], last_post_id, last_post_at)
  - posts (id, topic_id, forum_id, author_id, created_at, updated_at, edit_count, edit_reason)
  - posts_text (id → post_id, subject, message_bbcode, message_html, enable_sig)
  - polls: poll_questions, poll_options, poll_votes
  - private_messages, pm_text
  - smilies, ranks, word_censors, banned_users
  - sessions/online tracking
- [x] Supabase client module with typed queries
- [x] Seed script with sample data (a few categories, forums, users, topics, posts)

**Tests**: Verify migrations apply cleanly, seed data queryable, basic CRUD operations on each table.

---

## Chunk 3: Authentication ✅

**Goal**: Users can register, log in, log out. Sessions persist across requests.

- [x] Supabase Auth integration (signup, signin, signout, session refresh)
- [x] Hono middleware: extract session from cookie, attach user to context
- [x] Registration page (renders `profile_add_body.tpl` or simplified version)
- [x] Login page (renders `login_body.tpl`)
- [x] Logout route (clears session, redirects)
- [x] Template variables for auth state: `switch_user_logged_in`, `switch_user_logged_out`, `USERNAME`, `U_LOGIN_LOGOUT`, `U_PROFILE`, `U_PRIVATEMSGS`, `PRIVATE_MESSAGE_INFO`
- [x] Overall header/footer now render correctly with auth-aware nav

**Tests**: Registration flow, login/logout flow, session persistence, protected route access, template switch variables toggle correctly.

---

## Chunk 4: Forum Index & Browsing ✅

**Goal**: Forum index page showing categories and forums, with real data.

- [x] Index route (`/`) — queries categories + forums, renders `index_body.tpl`
- [x] Template data mapping: `catrow` block with nested `forumrow` block
- [x] Forum stats: topic count, post count, last post info per forum
- [x] "Mark forums read" functionality
- [x] Breadcrumb/nav links (`{U_INDEX}`, `{L_INDEX}`)

**Tests**: Index renders with correct category/forum structure, forum stats are accurate, empty forum displays correctly, auth-conditional sections render properly.

---

## Chunk 5: Viewing Forums (Topic Listing) ✅

**Goal**: Click a forum, see its topics with pagination.

- [x] Forum view route (`/viewforum/:id`) — renders `viewforum_body.tpl`
- [x] Query topics for forum with pagination (configurable per-page)
- [x] Topic list data: title, author, reply count, view count, last post info
- [x] Topic type indicators: normal, sticky (pinned to top), announcement, locked
- [x] Folder icons: new posts, no new posts, locked, hot topic
- [x] Sorting: by last post date (default), configurable
- [x] Pagination component with page links
- [x] "New topic" button (link to posting page)
- [x] Breadcrumbs: Index → Forum Name

**Tests**: Correct topic ordering (stickies first, then by last post), pagination boundaries, empty forum message, topic type icons resolve correctly.

---

## Chunk 6: Viewing Topics (Post Display) ✅

**Goal**: Click a topic, see its posts with author info.

- [x] Topic view route (`/viewtopic/:id`) — renders `viewtopic_body.tpl`
- [x] Query posts for topic with pagination
- [x] Post display: author name, avatar, rank, join date, post count, location
- [x] Post content: BBCode parsed to HTML (basic set: b, i, u, quote, code, url, img, list, color, size)
- [x] Post metadata: date, subject, edit info
- [x] Smilies: replace smiley codes with image tags
- [x] Word censoring: apply word filter to post content
- [x] Signature display below post (if enabled)
- [x] Increment topic view count on view
- [x] Action buttons per post: quote, edit, delete (permission-dependent)
- [x] Breadcrumbs: Index → Forum → Topic Title

**Tests**: BBCode rendering (each tag type), smiley replacement, word censoring, pagination, view count increment, post ordering, signature display toggle.

---

## Chunk 7: Posting & Replying ✅

**Goal**: Users can create new topics and reply to existing ones.

- [x] New topic route (`/posting?mode=newtopic&f=:forumId`) — renders `posting_body.tpl`
- [x] Reply route (`/posting?mode=reply&t=:topicId`)
- [x] Post submission: validate, parse BBCode, store in DB
- [x] Quote functionality: pre-fill reply with quoted post content
- [x] Post preview before submission
- [x] Smilies panel on posting page
- [x] BBCode toolbar buttons (client-side JS to insert tags)
- [x] Topic type selection (normal/sticky/announcement) for mods/admins
- [x] Update forum/topic stats on new post (post count, last post, reply count)
- [x] Redirect to new post after submission
- [x] Edit post route (`/posting?mode=editpost&p=:postId`)
- [x] Delete post (with confirmation, deletes topic if first post)

**Tests**: Topic creation flow, reply flow, BBCode storage and rendering round-trip, quote formatting, edit updates correctly, delete cascades properly, stats update on post/delete.

---

## Chunk 8: User Profiles ✅

**Goal**: View and edit user profiles.

- [x] View profile route (`/profile/:id`) — renders `profile_view_body.tpl`
- [x] Profile display: username, avatar, rank, join date, post count, location, website, occupation, interests, signature
- [x] "Search user's posts" link
- [x] Contact info: email (if enabled), PM link, website
- [x] Edit own profile route (`/profile`) — renders `profile_add_body.tpl`
- [x] Editable fields: signature, avatar, location, website, occupation, interests, timezone, email visibility
- [x] Avatar support: upload via Supabase Storage (S3-compatible) or external URL
- [x] Member list route (`/memberlist`) — renders `memberlist_body.tpl`
- [x] Member list sorting: by username, join date, post count, location

**Tests**: Profile data displays correctly, edit saves and reflects, avatar upload/display, member list sorting and pagination.

---

## Chunk 9: Private Messaging ✅

**Goal**: Users can send and receive private messages.

- [x] PM inbox route (`/privmsg?folder=inbox`) — renders `privmsgs_body.tpl`
- [x] PM folders: inbox, outbox, sentbox, savebox
- [x] Read PM route (`/privmsg?mode=read&p=:id`) — renders `privmsgs_read_body.tpl`
- [x] Compose PM route (`/privmsg?mode=post`) — posting form with recipient field
- [x] Reply to PM
- [x] Delete PMs (single and bulk)
- [x] Move PM to savebox
- [x] Unread PM count in header nav (`PRIVATE_MESSAGE_INFO`, `PRIVMSG_IMG`)
- [x] BBCode support in PMs

**Tests**: Send/receive flow, folder counts, read/unread status, delete, bulk operations, notification count updates.

---

## Chunk 10: Search ✅

**Goal**: Users can search posts and topics.

- [x] Search page route (`/search`) — renders `search_body.tpl`
- [x] Search by keywords (full-text search via Postgres `tsvector`)
- [x] Search by author
- [x] Filter by forum, time range
- [x] Search in: message body, title, or both
- [x] Results as topics (`search_results_topics.tpl`) or posts (`search_results_posts.tpl`)
- [x] Result pagination
- [x] Quick searches: "view new posts", "view your posts", "view unanswered"

**Tests**: Keyword search accuracy, author search, forum filtering, time range filtering, result display modes, pagination, quick search queries return correct results.

---

## Chunk 11: Polls ✅

**Goal**: Users can create polls in topics and vote.

- [x] Poll creation within new topic form (renders `posting_poll_body.tpl`)
- [x] Poll display on topic view: ballot (`viewtopic_poll_ballot.tpl`) or results (`viewtopic_poll_result.tpl`)
- [x] Vote submission (one vote per user)
- [x] View results after voting (bar chart display)
- [x] Poll duration (auto-close after N days)

**Tests**: Poll creation, voting, duplicate vote prevention, result calculation, poll expiry.

---

## Chunk 12: Moderation Tools ✅

**Goal**: Moderators can manage topics and posts.

- [x] Mod control panel route (`/modcp?f=:forumId`) — renders `modcp_body.tpl`
- [x] Lock/unlock topics
- [x] Move topics to different forum (`modcp_move.tpl`)
- [x] Split topic (`modcp_split.tpl`)
- [x] Delete topics (bulk)
- [x] Edit/delete any post (from topic view)
- [x] Permission checks: only mods (user_level >= 1) or admins
- [x] IP display in mod view

**Tests**: Each mod action with permission checks (mod can, regular user cannot), topic move updates forum stats, split creates valid new topic.

---

## Chunk 13: User Groups ✅

**Goal**: Users can join groups, group leaders can manage membership.

- [x] Group list/info route (`/groupcp`) — renders `groupcp_info_body.tpl`
- [x] Join open group
- [x] Request membership in closed group
- [x] Group leader: approve/deny requests
- [x] Group leader: manage members (`groupcp_user_body.tpl`)

**Tests**: Join/leave flow, pending request flow, leader approval.

---

## Chunk 14: Admin Panel — Core ✅

**Goal**: Admin can configure the board and manage forums.

- [x] Admin layout (admin header/footer templates)
- [x] Admin auth middleware (admin-only access)
- [x] Board configuration page (site name, description, feature toggles)
- [x] Forum management: create, edit, delete, reorder categories and forums

**Tests**: Admin-only access enforced, config changes persist, forum CRUD operations.

---

## Chunk 15: Admin Panel — Users & Content ✅

**Goal**: Admin can manage users, bans, ranks, smilies, word censors.

- [x] User management: search, edit profile, delete user
- [x] Ban management: ban/unban by username or email
- [x] Rank management: create ranks with post thresholds and images
- [x] Smilies management: add/edit/delete smilies
- [x] Word censor management: add/edit/delete word filters

**Tests**: User edit/delete, ban enforcement on login, rank display by post count, smiley rendering, word censor application.

---

## Chunk 16: Polish & Remaining Pages ✅

**Goal**: Complete remaining pages and polish the experience.

- [x] FAQ page (`/faq`) — renders `faq_body.tpl`
- [x] Who's online page (`/viewonline`) — renders `viewonline_body.tpl`
- [x] "Mark forums read" redirect

**Tests**: All remaining pages render without errors.

---

## Chunk 17: Per-Forum ACL (Group-Based Permissions) ✅

**Goal**: Implement phpBB2's group-based, per-forum permission system.

phpBB2 used a dual system: `user_level` for global admin/mod gating, plus group-based ACLs for per-forum permissions (`auth_access` table). Before this chunk the runtime only checked `user_level`; the schema columns existed but the gate functions were stubs ("simplified: deny unless admin").

- [x] Permission module `src/lib/permissions.ts` with `AUTH_LEVEL` constants (0=ALL, 1=REG, 2=ACL, 3=MOD, 5=ADMIN — phpBB2 numbering), `loadUserGroupAcls` (one round-trip across `user_group` × `auth_access`, OR'd per-forum), `canDo(action, forum, user, acls)`, `canMod(forumId, user, acls)`, `filterViewable`.
- [x] Schema already had the columns — used as-is. No auto-sync of `user_level` from group membership: per-forum mod status is computed at request time (`canMod` OR-s the group bit with the global level), avoiding trigger-based drift.
- [x] Read paths: index filters viewable forums, viewforum/viewtopic gate `auth_view` (404, no existence leak) and `auth_read` (403); the jumpbox/footer auth list now reflects reality.
- [x] Write paths: posting GET/POST gate per mode (newtopic→auth_post, reply→auth_reply, editpost/delete→own-post-with-bit OR per-forum mod), with sticky/announce checked against `auth_sticky`/`auth_announce`. Poll vote gates `auth_vote`, poll create gates `auth_pollcreate`. modcp's entry gates and IP-display use `canMod(forumId)` instead of global `isModOrAdmin`.
- [x] Admin matrix UI at `/admin/auth` → `/admin/auth/forum/:id` (per-forum required-level dropdowns) and `/admin/auth/group/:id` (per-group access matrix). Uses the original phpBB2 `auth_forum_body.tpl` and `auth_ug_body.tpl` unmodified. POST handlers clamp tampered values and clear all-unchecked rows from `auth_access`.
- [x] Tests: `test/lib/permissions.test.ts` (31 unit tests covering the matrix), `test/security/permissions.test.ts` (14 end-to-end tests with fixture forums and groups), plus 10 new admin-route tests in `test/routes/admin.test.ts`. Full suite: 311 tests.

Deferred (decided against during planning): per-user permission overrides via single-user groups. The schema column `groups.group_single_user` is still there for the day we want them; no per-user override mechanism is wired up yet. Bring it back when an actual use case forces the issue.

---

## Chunk 18: Remaining Polish

**Goal**: Features deferred from earlier chunks.

- [ ] Topic watching (subscribe to email notifications)
- [ ] "Mark forums/topics read" tracking (per-user, not just a redirect)
- [ ] Agreement/ToS page — renders `agreement.tpl`
- [ ] Error and confirmation pages (`error_body.tpl`, `confirm_body.tpl`, `message_body.tpl`)
- [ ] IP intelligence: enrich poster IPs with ASN/org info via local MaxMind GeoLite2 lookup (no per-request external API calls). Display in mod view to flag VPN/datacenter/hosting ranges. See "IP intelligence + bot protection" notes below for the full modern shape.
- [~] ~~Mass email to all users or groups~~ — **intentionally omitted**. Useful in 2005; in 2026 it's trivial to export the user list into Mailchimp / Buttondown / a self-hosted mailing-list platform and run campaigns there. Keeping mail-blast functionality in the forum invites compliance burden (CAN-SPAM, GDPR, deliverability reputation) for negligible benefit.
- [ ] New PM notification popup
- [ ] Performance review: query optimization, caching where needed

**Tests**: Notification emails send, read tracking works across sessions, IP enrichment resolves known datacenter ranges.

---

## Chunk 19: Code-Review Remediation ✅

**Goal**: Address security, robustness, and code-quality issues surfaced
in the April 2026 code review (see commits c35b516..71e2d3e).

- [x] Shared `escapeHtml`/`escapeRegex` utilities; consolidate to
  `getSupabaseAdmin()` singleton (eliminate ~30 inline createClient calls)
- [x] `USER_LEVEL` constants and `isAdmin`/`isMod`/`isModOrAdmin`
  predicates; fix `ADMIN_LINK` showing to mods
- [x] Fix hardcoded `unreadPms: 0` in auth middleware; delete dead
  `requireAuth`/`requireAdmin`; stop overwriting `session_start`; log
  fire-and-forget upsert errors
- [x] `MarkupString` brand for trusted HTML; flip the template engine to
  HTML-escape plain strings by default; migrate every `assignVars` site
- [x] CSRF protection: Hono origin/referer + per-session token; every
  form injects via `formHiddenFields(c, ...)`
- [x] Atomic counter maintenance via Postgres triggers (forum/topic/user
  post counts, first/last_post_id pointers) and RPC for view/vote counts
- [x] modcp split: switch from `Math.min(...id)` to `post_time` pivot;
  redirect to source forum when original topic is emptied
- [x] search FTS: `websearch_to_tsquery` (handles `&|!():`); dedup in SQL
  via `search_topics` RPC; pagination URL builder preserves query params
- [x] `RECORD_USERS` actually persists the all-time max
- [x] `.single()` → `.maybeSingle()` audit (~30 sites)
- [x] Cache invalidation hooks for smiley + word-censor admin mutations
- [x] Code quality: `src/auth/cookies.ts`, `src/lib/labels.ts`,
  `src/lib/avatar.ts`, `src/lib/config.ts`; XSS + CSRF regression tests;
  test isolation via `cleanupTestUser`
- [x] Username charset on registration: `[A-Za-z0-9._-]`

---

## Chunk 20: Hardening — Deferred from Chunk 19

**Goal**: Items the code-review remediation deliberately deferred. Both
need a deeper design pass than fits in a mechanical refactor.

- [ ] **Rate limiting on auth + posting endpoints.** Throttle
  `POST /login`, `POST /register`, `POST /posting` per IP and per
  username/email to blunt brute-force credential stuffing and
  posting-flood. Open questions: token-bucket vs sliding-window;
  in-process map vs Postgres-backed (so it survives restarts and works
  across multiple workers); how to expose the lockout state in the
  login UI without leaking enumeration; how to bypass for tests.
  Touches `src/routes/auth.ts`, `src/routes/posting.ts`, possibly a
  new `src/lib/rate_limit.ts` and a `rate_limits` table.
- [ ] **Honor user timezone preference end-to-end.** The profile form
  already collects a `TIMEZONE_SELECT` value (`profiles.user_timezone`,
  `profiles.user_dateformat`), but `formatPhpBBDate` in
  `src/lib/render.ts` hardcodes UTC. Threading the user's zone through
  every render site (post times, last-visit, RECORD_USERS date,
  EDITED_MESSAGE, etc.) is mostly mechanical but touches every page.
  Decision needed: pass `user.timezone` into `createPageTemplate` and
  derive a per-request formatter, or attach to the Hono context and
  let `formatPhpBBDate` read from there. Also: respect
  `profiles.user_dateformat` (PHP date() syntax) — needs a
  PHP-format-string interpreter or a documented subset.

**Tests**: Rate limiter blocks the Nth attempt within window, recovers
after the cooldown; per-IP and per-account independently. Date
formatter renders the same UTC instant differently in `UTC`,
`America/Los_Angeles`, and `Asia/Tokyo` profiles.
