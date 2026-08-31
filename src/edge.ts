import { Hono } from "hono";
import { registerApp } from "./app_core.js";
import { registerThemeAssetRoutes } from "./lib/theme_runtime.js";
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

// Uploaded themes first: when one is active these redirect to its objects and
// otherwise call next(), so the bundled-theme redirects below stay the
// default. Must precede them, or the bundled paths match first and an
// uploaded theme renders with Solaris's images.
registerThemeAssetRoutes(app);

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
/**
 * Shared secret proving a request came through our front proxy.
 *
 * The raw function URL (…supabase.co/functions/v1/plank/) is public and
 * verify_jwt is false, so anyone can reach the app directly, bypassing the
 * Cloudflare Worker entirely. That matters because everything the Worker adds
 * — the real client IP, the public host — arrives as ordinary custom headers
 * this file trusts unconditionally. Direct callers could therefore supply
 * their own x-plank-client-ip and rotate it per request, which defeats the
 * per-IP login and registration rate limiting completely, and forge the poster
 * IPs recorded for the mod tools.
 *
 * Enforcement is OPT-IN so that deploying this code cannot lock a running
 * site out before the secret exists on both sides:
 *   supabase secrets set PLANK_PROXY_SECRET=<value>
 *   wrangler secret put PLANK_PROXY_SECRET   (same value)
 * Until it is set on the function we log once and behave as before.
 */
const PROXY_SECRET = process.env.PLANK_PROXY_SECRET;
if (!PROXY_SECRET) {
  console.warn(
    "[plank] PLANK_PROXY_SECRET is not set — the function is reachable " +
      "directly, so x-plank-client-ip is spoofable and per-IP rate limiting " +
      "can be bypassed. See DEPLOYMENT.md."
  );
}

function secretMatches(provided: string | null): boolean {
  if (!PROXY_SECRET) return true; // not enforcing yet
  if (!provided || provided.length !== PROXY_SECRET.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ PROXY_SECRET.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (!secretMatches(req.headers.get("x-plank-proxy-secret"))) {
    // Deliberately terse: this is not a route, it's the front door.
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(req.url);
  url.pathname =
    url.pathname.replace(/^\/functions\/v1/, "").replace(/^\/plank/, "") || "/";
  // Observed: host is already public but the scheme arrives as http (TLS
  // terminated upstream) with x-forwarded-proto=https and no
  // x-forwarded-host — so apply each forwarded part independently.
  // The gateway STRIPS inbound x-forwarded-host, so a front proxy tunnels
  // the public host in x-plank-forwarded-host instead (custom headers pass
  // through). Without the right host here, hono/csrf's Origin check 403s
  // every POST arriving via the proxy.
  const xfProto = req.headers.get("x-forwarded-proto");
  if (xfProto) url.protocol = `${xfProto}:`;
  const xfHost =
    req.headers.get("x-plank-forwarded-host") ?? req.headers.get("x-forwarded-host");
  if (xfHost) url.host = xfHost;

  // Same trick for the client IP: the gateway rewrites x-forwarded-for to
  // its own view (the proxy's egress IP), which would bucket every visitor
  // into one rate-limit key. Translate the tunneled value back into
  // x-forwarded-for on the inner request so the app's clientIp() helper
  // stays proxy-agnostic.
  const inner = new Request(url, req);
  const tunneledIp = req.headers.get("x-plank-client-ip");
  if (tunneledIp) inner.headers.set("x-forwarded-for", tunneledIp);
  const res = await app.fetch(inner);

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
