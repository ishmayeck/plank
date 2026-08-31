import { createMiddleware } from "hono/factory";
import type { Hono, MiddlewareHandler } from "hono";
import { getSupabaseAdmin } from "../db/client.js";
import { PrecompiledTemplateLoader } from "../template/loader.js";
import { setTemplateLoader, setActiveTheme } from "../template/source.js";
import {
  fetchThemeManifest,
  getActiveThemeRecord,
  themeAssetUrl,
} from "./theme_store.js";

/**
 * Bridges the theme registry to the renderer.
 *
 * Chunk 21 left exactly one switch for "where do templates come from"
 * (`setTemplateLoader`). This resolves the active uploaded theme and throws
 * that switch, falling back to the bundled filesystem theme when none is
 * active — so an install that goes wrong degrades to Solaris rather than to a
 * blank board.
 *
 * Cached module-wide and invalidated explicitly, matching the smilies and
 * word-censor caches: a DB round trip per request to ask "which theme?" would
 * be a query on every page load for a value that changes about twice a year.
 * Admin mutations MUST call clearThemeRuntimeCache() — the same rule CLAUDE.md
 * already states for those other caches.
 */

interface ResolvedTheme {
  hash: string;
  name: string;
  /** The theme's own stylesheet filename, for T_HEAD_STYLESHEET. */
  stylesheet: string;
}

/** Stylesheet the bundled filesystem theme ships. */
const BUNDLED_STYLESHEET = "Solaris.css";

let resolved: ResolvedTheme | null = null;
let resolvedOnce = false;
/** In-flight resolution, so a burst of cold requests does one fetch, not N. */
let inFlight: Promise<void> | null = null;

/** Drop the cached theme so the next request re-resolves it. */
export function clearThemeRuntimeCache(): void {
  resolved = null;
  resolvedOnce = false;
  inFlight = null;
}

/** The active uploaded theme, or null when running on the bundled one. */
export function currentUploadedTheme(): ResolvedTheme | null {
  return resolved;
}

/**
 * Stylesheet filename for the active theme, for the T_HEAD_STYLESHEET
 * template variable. Hardcoding "Solaris.css" here meant every uploaded theme
 * rendered with the right markup and no styling at all.
 */
export function currentStylesheet(): string {
  return resolved?.stylesheet ?? BUNDLED_STYLESHEET;
}

async function resolveActiveTheme(): Promise<void> {
  const db = getSupabaseAdmin();
  const record = await getActiveThemeRecord(db);

  if (!record) {
    // No uploaded theme selected: bundled filesystem theme.
    setTemplateLoader(null);
    setActiveTheme("Solaris");
    resolved = null;
    resolvedOnce = true;
    return;
  }

  try {
    const manifest = await fetchThemeManifest(db, record.theme_hash);
    setTemplateLoader(new PrecompiledTemplateLoader(manifest));
    setActiveTheme(record.theme_name);
    resolved = {
      hash: record.theme_hash,
      name: record.theme_name,
      stylesheet: record.theme_stylesheet ?? `${record.theme_name}.css`,
    };
  } catch (err) {
    // A theme row pointing at a manifest we can't fetch must not take the
    // board down. Fall back and say so loudly.
    console.error(
      `[themes] active theme ${record.theme_name} (${record.theme_hash}) ` +
        `failed to load, falling back to the bundled theme:`,
      err instanceof Error ? err.message : err
    );
    setTemplateLoader(null);
    setActiveTheme("Solaris");
    resolved = null;
  }
  resolvedOnce = true;
}

/** Ensure the active theme is installed as the template source. */
export async function ensureThemeLoaded(): Promise<void> {
  if (resolvedOnce) return;
  // Collapse concurrent cold starts onto one resolution.
  if (!inFlight) {
    inFlight = resolveActiveTheme().finally(() => {
      inFlight = null;
    });
  }
  await inFlight;
}

/**
 * Resolve the active theme before any route renders. Cheap after the first
 * request (a boolean check); the first one pays a query plus a manifest fetch.
 */
export const themeMiddleware: MiddlewareHandler = createMiddleware(
  async (c, next) => {
    await ensureThemeLoaded();
    return next();
  }
);

/**
 * Serve an uploaded theme's own assets, and get out of the way otherwise.
 *
 * phpBB2 templates hard-code their asset paths (`templates/<Name>/images/x.gif`
 * appears 50 times in Solaris alone), so an uploaded theme asks for its files
 * under its own name. When one is active these redirect to its objects in
 * Storage; when none is, they call next() and the runtime's normal static
 * handling takes over — serveStatic on Node, the bucket redirects on Edge.
 *
 * BOTH entries must register this BEFORE their own static handlers, or those
 * handlers match first and an uploaded theme silently renders with the bundled
 * theme's images.
 */
export function registerThemeAssetRoutes(app: Hono): void {
  app.use("/templates/*", async (c, next) => {
    await ensureThemeLoaded();
    const active = currentUploadedTheme();
    if (!active) return next();

    // /templates/<AnyName>/rest → that theme's assets/rest
    const rest = c.req.path.replace(/^\/templates\/[^/]+\//, "");
    if (!rest) return next();
    return c.redirect(themeAssetUrl(getSupabaseAdmin(), active.hash, rest), 302);
  });

  app.use("/images/*", async (c, next) => {
    // Smilies are board content, not theme content — they live with the app
    // and must keep resolving however the runtime already serves them.
    if (c.req.path.startsWith("/images/smiles/")) return next();

    await ensureThemeLoaded();
    const active = currentUploadedTheme();
    if (!active) return next();

    const rest = c.req.path.slice("/images/".length);
    if (!rest) return next();
    return c.redirect(
      themeAssetUrl(getSupabaseAdmin(), active.hash, `images/${rest}`),
      302
    );
  });
}
