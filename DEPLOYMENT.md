# Deployment

Plank's compute is **Hono**, which is runtime-agnostic. The app runs today on
**Node** (`@hono/node-server`); the target deployment surface is **Supabase
Edge Functions** (Deno), keeping the stack Supabase-only. The same code is also
viable on **Cloudflare Workers** and in a **Node/Docker** container. This doc is
the runtime-portability audit (Chunk 22) and the remaining steps to ship.

## Status

- ✅ **Template engine is runtime-portable.** Chunk 21 put a `TemplateLoader`
  seam in front of the one impure dependency (`readFileSync`). Install a
  `PrecompiledTemplateLoader` at boot via `setTemplateLoader()` and rendering
  never touches the filesystem — it walks precompiled AST JSON. This was the
  one hard blocker to non-Node runtimes; it's gone.
- ✅ **devDependencies split** so a production/Edge bundle stays lean.
- ✅ **Rate limiting is Postgres-backed**, so it already works across many
  stateless Edge isolates (no in-process state to lose).
- ⬜ Remaining items below need a real Supabase project + cloud credentials,
  so they're owner-driven, not autonomously verifiable.

## Runtime audit — Node-only assumptions in `src/`

Swept for `node:*` imports, `process.cwd`/`import.meta.dirname`, `Buffer`,
`serveStatic`, and `@hono/node-server`. Findings:

| Site | What | Edge/Workers impact | Resolution |
|---|---|---|---|
| `template/engine.ts`, `loader.ts` | `node:fs` (`readFileSync`, `statSync`), `node:path` | `fs` unavailable on Edge; `path` is fine (Deno + workerd `nodejs_compat`) | **Already handled** — fs is only hit by `FsTemplateLoader`. Install a precompiled loader at boot; fs path goes dead. |
| `template/source.ts:24` | `import.meta.dirname` for the theme dir | Only reached in filesystem mode (no loader installed) | Dead branch on Edge. Leave as the Node/dev default. |
| `app.ts` | `serveStatic` from `@hono/node-server` for theme CSS/images, smilies, phpBB2 root images | **Real Node coupling.** No local filesystem to serve from. | Serve static assets from Supabase Storage / a CDN bucket (avatars already do this). The "Static assets" step below. |
| `index.ts` | `serve()` from `@hono/node-server`, port 3000 | Edge has its own entrypoint | Add a separate Edge entry that exports the fetch handler; keep `index.ts` as the Node entry. |
| `app.ts:1` | `import "dotenv/config"` | Edge injects env directly; no `.env` at runtime | Guard/remove the dotenv import in the Edge build; load config from platform env. |
| `lib/avatar.ts`, `routes/profile.ts` | `image-size` + `Buffer` for avatar upload | `image-size` is pure-JS (OK); `Buffer` exists in Deno + workerd `nodejs_compat` | Likely fine — **smoke-test** on the target runtime rather than assume. |
| `db/client.ts`, `auth/middleware.ts` | `@supabase/supabase-js` v2 | fetch-based, runtime-agnostic | No change. |

**Conclusion:** no surprises. The only genuine Node couplings left are exactly
the three Chunk 22 already names — **static assets, the server entry, and
dotenv/secrets**. Everything else is either already abstracted (templates) or
portable as-is (Supabase client, Hono, `image-size`, `path`).

## Remaining steps (owner-driven)

1. **Edge entry.** Add `src/edge.ts` that builds the same Hono `app` and exports
   the fetch handler Supabase Edge expects (one catch-all function under
   `/functions/v1/plank`, custom-domain rewrite so `/` maps to it). Keep
   `src/index.ts` as the Node entry. Smoke-test Hono-on-Deno.
2. **Secrets.** Replace `dotenv` at runtime with platform env
   (`supabase secrets set SUPABASE_URL=… SERVICE_ROLE_KEY=…`). `lib/config.ts`
   already centralizes env reads — point it at the injected vars.
3. **Compiled templates at deploy.** Add a build step that compiles every active
   `.tpl` to AST JSON (`serializeAst`) and writes it to a `compiled_templates`
   table (or Storage). At boot, hydrate a `PrecompiledTemplateLoader` and call
   `setTemplateLoader(loader)`. Then no render ever parses or reads a file.
   (Co-located with Postgres ⇒ the read is a local hop ⇒ this stack needs no KV.)
4. **Static assets.** Move theme CSS/images + smilies off `serveStatic` to
   Supabase Storage / a CDN bucket; update the asset URLs the templates emit.
5. **Verify.** Route smoke test against the deployed function (auth → post →
   view → search round-trip); confirm a render path touches zero filesystem.
6. **Data API lockdown (before go-live).** Hosted-project hardening: today the
   app tables have no RLS and are auto-exposed via PostgREST, so the anon key
   can read everything — including `private_messages` and poster IPs. This is
   tolerable only because Plank is server-rendered (the anon key never ships
   to a browser), but the correct end-state is to revoke `anon`/`authenticated`
   table access entirely and make the service-role client the only DB path —
   authorization is already app-level (`src/lib/permissions.ts`); the
   per-request client uses no RLS features. Needs a migration (revokes) + a
   sweep of the 37 anon-client read sites. Project-creation toggles
   ("auto-expose new tables" off / "automatic RLS" on) would break the app
   as-is — leave them at defaults and do this lockdown deliberately instead.

## Other stacks (same engine, different loader + entry)

| | Compiled AST lives | Static assets | Compute entry |
|---|---|---|---|
| **Supabase-only** (target) | Postgres / Storage | Supabase Storage | Edge Function |
| **Supabase + Cloudflare** | Cloudflare KV / R2 | R2 | Worker (`export default`) |
| **Supabase + Node/Docker** | filesystem (default) | `serveStatic` (default) | `@hono/node-server` |

The Node/Docker stack runs **today** with no changes — it's the current dev
setup. The other two swap a `TemplateLoader`, an asset source, and an entry
file; the engine and all route logic are identical.
