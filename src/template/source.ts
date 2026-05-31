import { join } from "node:path";
import { Template, type TemplateLoader } from "./engine.js";

/**
 * Central template source (Chunk 21 rung-2 wiring).
 *
 * Every place that renders a page goes through `createTemplate()` instead of
 * `new Template(THEME_DIR)`. That makes the byte source a single switch:
 *
 *   - default (Node/dev/Docker): filesystem theme directory
 *   - deployment (Supabase Edge / Workers): call `setTemplateLoader(...)` once
 *     at boot with a PrecompiledTemplateLoader, and every render path follows
 *     — no per-call-site changes (see ROADMAP Chunk 22).
 *
 * The active theme name is also centralized here rather than duplicated across
 * render.ts / posting.ts.
 */

let activeTheme = "Solaris";
let activeLoader: TemplateLoader | null = null;

/** Absolute path to the current theme's directory on the filesystem. */
export function themeDir(): string {
  // source.ts lives in src/template/, so ../../themes resolves to <repo>/themes
  return join(import.meta.dirname, "..", "..", "themes", activeTheme);
}

/** Currently active theme name (e.g. "Solaris"). */
export function getActiveTheme(): string {
  return activeTheme;
}

/** Switch the active theme (filesystem mode). */
export function setActiveTheme(name: string): void {
  activeTheme = name;
}

/**
 * Install a TemplateLoader as the process-wide template source. Pass `null`
 * to revert to the filesystem theme directory. Call once at boot on runtimes
 * without filesystem access.
 */
export function setTemplateLoader(loader: TemplateLoader | null): void {
  activeLoader = loader;
}

/** The active loader, if one is installed. */
export function getTemplateLoader(): TemplateLoader | null {
  return activeLoader;
}

/**
 * Create a Template bound to the active source: the installed loader if any,
 * otherwise the filesystem theme directory. Use this everywhere instead of
 * constructing `new Template(...)` directly.
 */
export function createTemplate(): Template {
  return activeLoader ? new Template(activeLoader) : new Template(themeDir());
}
