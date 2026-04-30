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
│   ├── index.ts             # Hono app entry point
│   ├── template/            # phpBB2 template engine
│   ├── routes/              # Hono route handlers
│   ├── db/                  # Supabase client and queries
│   ├── auth/                # Authentication middleware
│   └── lib/                 # Shared utilities (bbcode, smilies, pagination, etc.)
├── test/                    # Vitest tests (mirrors src/ structure)
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

## Key Design Decisions

- The phpBB2 template engine is a standalone module — no Hono dependency
- Original theme files (.tpl, .css, images) are served as-is, not converted
- Supabase Auth handles registration, login, sessions — not a custom auth system
- Supabase Storage (S3-compatible) handles avatar uploads
- BBCode is parsed server-side to HTML before injecting into templates
- Admin panel will use the same template engine with admin .tpl files
- IP intelligence: store poster IP, enrich with AS/org info via local lookup (no per-request external API calls). Useful for identifying VPN/datacenter/bot traffic in mod tools — not for old-school IP banning.

## Reference

- See `ROADMAP.md` for the implementation plan (chunked, ordered)
- Original phpBB2 source in `vendor/phpBB2/` for reference on behavior and data structures
- Original phpBB2 template engine: `vendor/phpBB2/includes/template.php`
