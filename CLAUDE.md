# Plank

A modern forum application that reimplements the phpBB2 experience, including a faithful phpBB2 template engine that can render original phpBB2 themes (like Solaris) unmodified. Named Plank, because it's a board.

## Stack

- **Runtime**: Node.js (or any Hono-compatible runtime)
- **Framework**: Hono (HTTP routing, middleware, SSR)
- **Database**: Supabase (Postgres + Auth + Storage)
- **Template Engine**: Custom phpBB2-compatible engine (renders original .tpl files)
- **Testing**: Vitest (TDD approach)
- **Language**: TypeScript

## Architecture

```
Request → Hono Router → Controller (fetches data from Supabase)
                              ↓
                    phpBB2 Template Engine
                     loads .tpl files
                     injects data context
                              ↓
                    HTML string → Response
```

The template engine is a standalone module with no framework dependencies. It takes a `.tpl` file path and a data object, returns an HTML string.

## Project Structure

```
plank/                       # Repository root
├── src/
│   ├── index.ts             # Hono app entry point (validates env, then serves)
│   ├── app.ts               # Hono app: middleware wiring + route mounts
│   ├── template/            # phpBB2 template engine (escape-by-default)
│   ├── routes/              # Hono route handlers
│   ├── db/                  # Supabase client singletons
│   ├── auth/                # Auth middleware + cookie option constants
│   └── lib/                 # Shared utilities:
│                            #   escape, markup, userLevel, csrf, labels,
│                            #   bbcode, smilies, wordcensor, pagination,
│                            #   render, avatar, config
├── test/                    # Vitest tests (mirrors src/ structure)
│   ├── security/            # XSS + CSRF regression tests
│   └── util/                # Shared test helpers (e.g. cleanupTestUser)
├── themes/                  # Theme directories (Solaris symlinked from vendor/)
├── static/                  # Static assets served by Hono
├── supabase/                # Supabase local config and migrations
├── docker-compose.yml       # Dev environment (runs original phpBB2 locally)
└── vendor/                  # Unversioned reference material
    ├── phpBB2/              # Original phpBB2 source (reference only)
    └── Solaris/             # Original Solaris theme (used directly by the app)
```

## Development Commands

```bash
npm test              # Run vitest
npm run dev           # Start Hono dev server
```

## Conventions

- TDD: write tests first, then implement
- Template engine must pass tests using original unmodified .tpl files
- Keep Hono handlers thin — business logic in db/ and lib/ modules
- Use Supabase client library, not raw SQL, where practical
- Supabase migrations for all schema changes

### Patterns to follow (don't regress these)

- **Templates auto-escape plain strings.** `tpl.assignVars({ FOO: someText })`
  HTML-escapes `someText` at render time. For pre-rendered HTML you trust,
  wrap with `markup(...)` from `src/lib/markup.ts` (or return `MarkupString`
  from a helper). User-controlled fields like usernames, topic titles,
  signatures, etc. should be passed as plain strings — the engine does the
  right thing.
- **CSRF: every form needs `formHiddenFields(c, ...extraInputsHtml)`** from
  `src/lib/csrf.ts` injected into `S_HIDDEN_FIELDS`. The middleware in
  `src/app_core.ts` rejects POSTs with a missing or mismatched token. Tests
  bypass via `SKIP_CSRF=1` (set in `vitest.config.ts`); production must
  never set that flag. The dedicated CSRF coverage in
  `test/security/csrf.test.ts` clears the flag to verify forged requests
  get 403.
  - A **backstop** (`csrfFormInjectionMiddleware`) stamps the token into any
    POST form in an HTML response that doesn't already carry one. Original
    phpBB2 templates hard-code `<form method="post">` with no
    `S_HIDDEN_FIELDS` slot inside (memberlist, viewforum, admin forum/ranks),
    and drop-in themes (Chunk 23) will be the same — we render themes
    unmodified, so the controller has nowhere to put the field. Keep calling
    `formHiddenFields` where you can; the backstop is for what you can't reach.
  - **Actions triggered by a LINK, not a form** (the admin delete/reorder/
    resync endpoints, modcp lock/unlock) mutate on GET, which the token
    middleware treats as safe and never checks. Those carry the token in the
    query string: build the URL with `csrfQueryParam(c)` and validate with
    `validateQueryCsrf(c)` in the handler.
  - `getCsrfToken(c)` is **memoized per request**. It reads the request
    cookie, so without the memo every call on a first visit (before any
    cookie exists) mints a different token and only the last matches.
- **Authorization comes from the target row, never a request field.** A
  handler that reaches a record by id must re-derive authority from that
  record: `canModAllTopics` for modcp targets, `loadOwnedPm` for private
  messages, `topic.forum_id` (not `body.forum_id`) when inserting a reply.
  Gating the GET that renders a form is not gating the POST that submits it —
  that split is where every IDOR in the August 2026 review lived.
- **`canDo` throws if the forum row lacks the `auth_*` column** it needs, so
  select `forums(*)` rather than a subset when a page asks about several
  actions. Defaulting a missing column to "unrestricted" silently granted
  access to everyone.
- **Queries that range ACROSS forums** (search, quick-searches, anything not
  scoped to one forum row) must constrain on `loadAccessibleForumIds()`. They
  can't use the single-row gate, and an empty result from that helper means
  "nothing is reachable", never "skip the filter".
- **User-supplied URLs need `safeExternalUrl()`** from `src/lib/url.ts`
  before going into an `href`/`src`. `escapeHtml` prevents attribute
  breakout but does nothing about a `javascript:` scheme, which needs none of
  the characters it escapes.
- **Post-processing passes over rendered HTML** (`applyCensors`,
  `replaceSmilies`) operate on text between tags only, and substitute via a
  replacer *function*. Running them over raw markup let a matched token
  inside an attacker-chosen URL rewrite the surrounding attributes; passing a
  replacement *string* let `$&`/`` $` ``/`$'` splice in nearby content.
- **User-level checks use named predicates** (`isAdmin`, `isMod`,
  `isModOrAdmin` from `src/lib/userLevel.ts`) and `USER_LEVEL.{USER,ADMIN,MOD}`
  constants. Never write raw `userLevel === 1` or `userLevel >= 1` in
  business logic.
- **Counters are maintained by the database, not by handlers.** Triggers in
  `supabase/migrations/20260430000001_atomic_counters.sql` keep
  `forum_posts`, `forum_topics`, `topic_replies`, `topic_first_post_id`,
  `topic_last_post_id`, `forum_last_post_id`, and `user_posts` in sync as
  posts/topics insert/update/delete. For per-request counters that don't
  derive from a row (`topic_views`, `poll_options.vote_count`), call the
  RPC functions `increment_topic_views` / `increment_poll_vote` — never
  read-then-write from JS, that race-bug is what prompted the migration.
- **ALL data access goes through `getSupabaseAdmin()`** from
  `src/db/client.ts` (singleton; don't construct your own). The Data API
  is locked down (`20260609000002_data_api_lockdown.sql`): RLS is enabled
  on every public table and `anon`/`authenticated` have no grants, so a
  query on the per-request client returns `permission denied` — never
  read or write data through it. The per-request anon client (the only
  other `createClient(...)` in the codebase, in the auth middleware)
  exists solely for Auth API calls: `setSession`, `signInWithPassword`,
  `signOut`. Authorization is app-level (`src/lib/permissions.ts`), not
  RLS policies.
- **`.maybeSingle()` for "0 rows is fine" lookups.** Reserve `.single()`
  for queries that must return exactly one row (typically right after an
  insert+select).
- **Admin mutations on smilies / word_censors must invalidate the
  in-memory cache** by calling `clearSmiliesCache()` /
  `clearCensorCache()` from `src/lib/smilies.ts` / `wordcensor.ts`. The
  caches are module-scoped and persist for the process lifetime.
- **`renderErrorBox`, `renderJumpbox`, `formatUsernameLink`,
  `parseBBCode`, `replaceSmilies`, `applyCensors`, `generatePagination`,
  `topicGotoPage`** all return `MarkupString` (or take/return them via
  function overload, in `applyCensors`'s case). Their output goes
  straight into `assignVars` without further wrapping.
- **Tests that create users via Supabase Auth** should use
  `cleanupTestUser` from `test/util/users.ts` in `beforeAll` — it tears
  down auth.users entries by email so re-runs don't collide on
  fixed-email fixtures (`supabase db reset` doesn't truncate auth).
- **Finish visual or preference-driven work by looking at it in a browser**,
  not by trusting a green suite. Start the dev server and drive the actual
  page (the in-app Browser pane, or Chrome for anything needing a real
  logged-in session). Two real bugs shipped past a full green run because
  assertions about rendered HTML cannot see them: a drop-in theme that
  rendered perfectly and *completely unstyled* (`T_HEAD_STYLESHEET` was
  hardcoded to `Solaris.css`), and timezone preferences that silently fell
  back to UTC. In both cases the HTML was correct — the markup, the escaping,
  the block iteration — and the thing that was wrong sat outside what any
  assertion was looking at.
  - **Check what is actually listening before debugging a 404.** A stale
    `tsx watch` holding port 3000 makes the new server die with `EADDRINUSE`
    into a log you aren't reading, and you end up "debugging" code that isn't
    running. `pkill -f "tsx watch"` does not always match it;
    `ss -lptn 'sport = :3000'` gives the real PID.
- **Security tests ENUMERATE a surface; they don't sample it.**
  `test/security/invariants.test.ts` walks every form on every page (with the
  real CSRF middleware on, which the rest of the suite disables) and every
  source file for unguarded URL attributes. This exists because the sampled
  suites passed while five forms shipped without tokens and four routes
  shipped without ACL gates — the bugs were always in the sibling nobody
  thought to sample. When you add a page, add it to the sweep list.
- **The test suite runs serially (`fileParallelism: false` in
  `vitest.config.ts`).** DB-backed suites share one local Supabase and
  seed fixed-email users + fixed category/forum rows; running files in
  parallel makes them collide non-deterministically (each file passes
  alone, the full suite fails a different handful every run). Don't
  re-enable parallelism without first isolating fixtures per file. A
  clean signal needs `supabase db reset` before a full run, since some
  suites mutate seed rows.
- **Construct templates via `createTemplate()` from
  `src/template/source.ts`, never `new Template(THEME_DIR)`.** The engine
  renders from a compiled AST sourced through a `TemplateLoader`
  (`src/template/loader.ts`); `createTemplate()` returns one bound to the
  active source — filesystem by default, or whatever `setTemplateLoader()`
  installed at boot (e.g. a `PrecompiledTemplateLoader` reading AST JSON on
  Supabase Edge / Workers, where there's no filesystem). `compile()` is
  memoized by content and file reads by path+mtime, so this is also the
  fast path. `<!-- INCLUDE x.tpl -->` is supported (render-time,
  cycle-guarded). See `DEPLOYMENT.md`.
- **Rate-limited endpoints call `checkRateLimit(key, rule)`** from
  `src/lib/rate_limit.ts` (login, register, posting). It's Postgres-backed
  (the `check_rate_limit` RPC) so it works across stateless Edge isolates
  and never read-then-writes from JS; it fails OPEN on RPC error. Tests
  bypass via `SKIP_RATE_LIMIT=1` (set in `vitest.config.ts`, mirroring
  `SKIP_CSRF`); `test/security/rate_limit.test.ts` clears it. Login is
  keyed by IP with a generic (non-enumerating) message.
- **Uploaded themes go through `ingestThemeZip()`** from
  `src/lib/theme_package.ts` — the only place untrusted bytes are unzipped,
  so it carries the hardening (zip-slip, zip-bomb caps, extension
  allowlist, archive-junk filter). It compiles `.tpl` → AST and
  content-addresses by SHA-256. Keep the unzip the single chokepoint; don't
  unzip uploads elsewhere. `src/lib/theme_store.ts` persists a package
  (Storage + the `themes` table) and `src/lib/theme_runtime.ts` resolves the
  active one and throws the Chunk 21 loader switch — cached module-wide, so
  **admin theme mutations must call `clearThemeRuntimeCache()`**, the same
  rule as the smilies and word-censor caches.
  - **A theme's `.tpl` text becomes the page's HTML.** The AST is inert data,
    so an upload can't execute anything server-side and can't bypass the
    escaping applied to values Plank substitutes in — but literal `<script>`
    in a template runs for every visitor, because that text IS the page.
    Excluding `.js` from the allowlist buys less than it looks. Theme upload
    is admin-only and full-trust; don't ever expose it more widely.
  - **Nothing may hardcode the theme name or its asset filenames.** phpBB2
    themes reference their own directory (`templates/<Name>/images/...`) and
    name their stylesheet after themselves. Asset routes ignore the name in
    the path and serve the active theme; `T_HEAD_STYLESHEET` comes from
    `currentStylesheet()`. Hardcoding `Solaris.css` there made every uploaded
    theme render unstyled, and no HTML assertion could see it.

## Key Design Decisions

- The phpBB2 template engine is a standalone module — no Hono dependency.
- The engine substitutes `{VAR}` like phpBB2 did, but **escapes plain
  strings by default**. This is a deliberate departure from phpBB's raw
  substitution, made to neutralize a class of stored-XSS bugs. Use
  `markup()` to opt out for trusted HTML.
- Original theme files (.tpl, .css, images) are served as-is, not converted.
- Supabase Auth handles registration, login, sessions — not a custom auth
  system. The per-request anon client carries session state; the
  service-role client is a singleton.
- Supabase Storage (S3-compatible) handles avatar uploads.
- BBCode is parsed server-side to HTML before injecting into templates.
  `parseBBCode` returns `MarkupString` so the engine doesn't double-escape.
- Admin panel uses the same template engine with admin .tpl files.
- **Counters are derived, not maintained by hand.** Postgres triggers
  keep forum/topic/user post counts and last-post pointers in sync from
  posts/topics row events. Per-request counters (views, votes) use atomic
  RPC functions. JS handlers never read-then-write counters.
- **CSRF**: every state-changing POST is protected by Hono's `csrf()`
  origin/referer check plus a per-session token validated against a
  `plank-csrf` cookie. Forms inject the token via `formHiddenFields(c)`.
- User levels follow phpBB2's numbering (`0=user, 1=admin, 2=mod`),
  preserved in the schema for compatibility with possible phpBB2 data
  imports. Code never references the numbers directly — predicates and
  the `USER_LEVEL` constant in `src/lib/userLevel.ts` do.
- IP intelligence (planned): store poster IP, enrich with AS/org info via
  local lookup (no per-request external API calls). Useful for identifying
  VPN/datacenter/bot traffic in mod tools — not for old-school IP banning.

## Reference

- See `ROADMAP.md` for the implementation plan (chunked, ordered)
- Original phpBB2 source in `vendor/phpBB2/` for reference on behavior and data structures
- Original phpBB2 template engine: `vendor/phpBB2/includes/template.php`
