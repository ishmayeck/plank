import { Hono } from "hono";
import { registerApp } from "./app_core.js";
import { PrecompiledTemplateLoader } from "./template/loader.js";
import { setTemplateLoader } from "./template/source.js";

/**
 * Supabase Edge Functions entry (Chunk 22).
 *
 * Bundled by `npm run build:edge` (esbuild) into
 * supabase/functions/plank/index.ts — a single self-contained file, so the
 * Deno runtime never has to resolve our NodeNext-style `.js` imports or
 * node_modules. Differences from the Node entry (src/app.ts):
 *
 *   - No dotenv: the platform injects SUPABASE_URL / SUPABASE_ANON_KEY /
 *     SUPABASE_SERVICE_ROLE_KEY into the function's environment.
 *   - No serveStatic: theme CSS/images/smilies live in the public
 *     `theme-assets` Storage bucket; the /templates/* and /images/* routes
 *     302-redirect there (templates stay unmodified — same URLs, new home).
 *   - No template filesystem: the compiled AST manifest (output of
 *     scripts/compile-theme.ts, uploaded to Storage) is fetched once per
 *     isolate at cold start and installed via setTemplateLoader(). After
 *     that, rendering is a pure walk over in-memory ASTs.
 */

declare const Deno: {
  env: { toObject(): Record<string, string> };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

// The app reads config via process.env everywhere. Supabase's edge runtime
// provides Node globals, but shim defensively in case process is absent.
if (typeof (globalThis as { process?: unknown }).process === "undefined") {
  (globalThis as Record<string, unknown>).process = { env: Deno.env.toObject() };
}

const SUPABASE_URL = process.env.SUPABASE_URL!;
const ASSET_BASE = `${SUPABASE_URL}/storage/v1/object/public/theme-assets`;

// ── Cold start: hydrate compiled templates from Storage ──────────────
// One fetch per isolate (co-located with the project, so it's a local hop),
// then every render is served from memory.
const manifestRes = await fetch(`${ASSET_BASE}/manifests/Solaris.json`);
if (!manifestRes.ok) {
  throw new Error(
    `Template manifest fetch failed: ${manifestRes.status} ${manifestRes.statusText}`
  );
}
const manifest = (await manifestRes.json()) as Record<string, string>;
setTemplateLoader(new PrecompiledTemplateLoader(manifest));

// ── App ──────────────────────────────────────────────────────────────
// Routes are registered at root paths; the serve handler below strips the
// platform prefix (/functions/v1/plank, or just /plank behind a custom
// domain) before dispatch, so the app is agnostic to how it's mounted.
const app = new Hono();

// Static assets: redirect to the public bucket. Registration order mirrors
// src/app.ts — smilies before the broader /images/* wildcard.
app.get("/templates/Solaris/*", (c) => {
  const rest = c.req.path.split("/templates/Solaris/")[1] ?? "";
  return c.redirect(`${ASSET_BASE}/templates/Solaris/${rest}`, 302);
});
app.get("/images/smiles/*", (c) => {
  const rest = c.req.path.split("/images/smiles/")[1] ?? "";
  return c.redirect(`${ASSET_BASE}/images/smiles/${rest}`, 302);
});
// Locally /images/* is rooted at themes/Solaris/, i.e. /images/x maps to
// the theme's images/ dir — mirror that mapping inside the bucket.
app.get("/images/*", (c) => {
  const rest = c.req.path.split("/images/")[1] ?? "";
  return c.redirect(`${ASSET_BASE}/templates/Solaris/images/${rest}`, 302);
});

registerApp(app);

// Normalize the request before dispatch:
//  - Prefix: the function receives the full original path
//    (/functions/v1/plank/...); a future custom-domain rewrite may present
//    /plank/... or bare paths. Strip whichever is present.
//  - Origin: the gateway terminates TLS, so req.url carries an internal
//    host. Rebuild it from X-Forwarded-Host/-Proto so everything derived
//    from c.req.url — the hono/csrf Origin check, login redirects,
//    pagination links — sees the public origin.
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  url.pathname =
    url.pathname.replace(/^\/functions\/v1/, "").replace(/^\/plank/, "") || "/";
  // Observed: host is already public but the scheme arrives as http (TLS
  // terminated upstream) with x-forwarded-proto=https and no
  // x-forwarded-host — so apply each forwarded part independently.
  const xfProto = req.headers.get("x-forwarded-proto");
  if (xfProto) url.protocol = `${xfProto}:`;
  const xfHost = req.headers.get("x-forwarded-host");
  if (xfHost) url.host = xfHost;
  const res = await app.fetch(new Request(url, req));

  // The shared *.supabase.co functions domain rewrites text/html responses
  // to text/plain (anti-phishing policy; see DEPLOYMENT.md). Declare the
  // true type in a marker header that survives the rewrite, so a front
  // proxy (infra/cloudflare/plank-proxy.js) can restore it. Harmless and
  // redundant on a custom domain, where the rewrite doesn't happen.
  const ct = res.headers.get("content-type");
  if (ct && ct.includes("text/html")) {
    const out = new Response(res.body, res);
    out.headers.set("x-plank-content-type", ct);
    return out;
  }
  return res;
});
