import type { SupabaseClient } from "@supabase/supabase-js";
import type { ThemePackage } from "./theme_package.js";

/**
 * Storage + registry for uploaded themes (Chunk 23).
 *
 * `ingestThemeZip` turns untrusted bytes into a compiled, content-addressed
 * package; this module is where that package is persisted and looked up. The
 * split matters: ingestion is pure and runtime-agnostic (it's the part that
 * has to be safe), while everything here talks to Supabase.
 *
 * Layout in the public `theme-assets` bucket:
 *
 *   themes/<hash>/manifest.json     compiled AST, { templateName: serializedAst }
 *   themes/<hash>/assets/<path>     the theme's own css / images / cfg
 *
 * Keying on the zip's SHA-256 means a re-upload of identical bytes is a no-op
 * and a re-upload of changed bytes lands on a fresh path, so nothing has to be
 * cache-busted by hand.
 */

const BUCKET = "theme-assets";

export interface ThemeRecord {
  id: number;
  theme_name: string;
  theme_hash: string;
  installed_at: string;
  is_active: boolean;
}

export class ThemeStoreError extends Error {}

function manifestPath(hash: string): string {
  return `themes/${hash}/manifest.json`;
}

function assetPath(hash: string, name: string): string {
  return `themes/${hash}/assets/${name}`;
}

/** Content types for the extensions ingestThemeZip allows through. */
const CONTENT_TYPES: Record<string, string> = {
  css: "text/css",
  cfg: "text/plain",
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

function contentTypeFor(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Persist an ingested package and register it. Idempotent by hash: uploading
 * the same archive twice overwrites the same objects and updates the same row.
 *
 * Does NOT activate the theme — installing and switching are separate actions
 * so an admin can upload without changing what visitors see.
 */
export async function installTheme(
  db: SupabaseClient,
  pkg: ThemePackage
): Promise<ThemeRecord> {
  const storage = db.storage.from(BUCKET);

  const manifest = await storage.upload(
    manifestPath(pkg.hash),
    new TextEncoder().encode(JSON.stringify(pkg.templates)),
    { upsert: true, contentType: "application/json" }
  );
  if (manifest.error) {
    throw new ThemeStoreError(`Manifest upload failed: ${manifest.error.message}`);
  }

  for (const name of pkg.assetNames) {
    const bytes = pkg.assets[name];
    if (!bytes) continue;
    const { error } = await storage.upload(assetPath(pkg.hash, name), bytes, {
      upsert: true,
      contentType: contentTypeFor(name),
    });
    if (error) {
      throw new ThemeStoreError(`Asset upload failed (${name}): ${error.message}`);
    }
  }

  const { data, error } = await db
    .from("themes")
    .upsert(
      { theme_name: pkg.name, theme_hash: pkg.hash },
      { onConflict: "theme_hash" }
    )
    .select()
    .single();

  if (error || !data) {
    throw new ThemeStoreError(`Theme registration failed: ${error?.message}`);
  }
  return data as ThemeRecord;
}

/** Installed themes, newest first. */
export async function listThemes(db: SupabaseClient): Promise<ThemeRecord[]> {
  const { data } = await db
    .from("themes")
    .select("*")
    .order("installed_at", { ascending: false });
  return (data ?? []) as ThemeRecord[];
}

/** The active theme, or null when none is (so we fall back to the bundled one). */
export async function getActiveThemeRecord(
  db: SupabaseClient
): Promise<ThemeRecord | null> {
  const { data } = await db
    .from("themes")
    .select("*")
    .eq("is_active", true)
    .maybeSingle();
  return (data as ThemeRecord) ?? null;
}

/**
 * Make one theme active. Deactivates the previous one first — the partial
 * unique index would reject two active rows, so the order is not optional.
 */
export async function activateTheme(
  db: SupabaseClient,
  hash: string
): Promise<void> {
  const { data: target } = await db
    .from("themes")
    .select("id")
    .eq("theme_hash", hash)
    .maybeSingle();
  if (!target) throw new ThemeStoreError(`No such theme: ${hash}`);

  await db.from("themes").update({ is_active: false }).eq("is_active", true);
  const { error } = await db
    .from("themes")
    .update({ is_active: true })
    .eq("theme_hash", hash);
  if (error) throw new ThemeStoreError(`Activation failed: ${error.message}`);
}

/** Revert to the bundled filesystem theme by deactivating whatever is active. */
export async function deactivateAllThemes(db: SupabaseClient): Promise<void> {
  await db.from("themes").update({ is_active: false }).eq("is_active", true);
}

/**
 * Remove a theme and its stored objects. Refuses to delete the active theme —
 * doing so would leave the board with a manifest it can't fetch.
 */
export async function deleteTheme(
  db: SupabaseClient,
  hash: string
): Promise<void> {
  const { data: row } = await db
    .from("themes")
    .select("is_active")
    .eq("theme_hash", hash)
    .maybeSingle();
  if (!row) throw new ThemeStoreError(`No such theme: ${hash}`);
  if ((row as ThemeRecord).is_active) {
    throw new ThemeStoreError(
      "Cannot delete the active theme. Switch to another theme first."
    );
  }

  const storage = db.storage.from(BUCKET);
  const { data: assets } = await storage.list(`themes/${hash}/assets`);
  const paths = [
    manifestPath(hash),
    ...(assets ?? []).map((f) => assetPath(hash, f.name)),
  ];
  if (paths.length) await storage.remove(paths);

  await db.from("themes").delete().eq("theme_hash", hash);
}

/**
 * Fetch a theme's compiled manifest. Public bucket, so this is a plain fetch
 * of a public URL — one round trip, cacheable by the platform's CDN.
 */
export async function fetchThemeManifest(
  db: SupabaseClient,
  hash: string
): Promise<Record<string, string>> {
  const { data } = db.storage.from(BUCKET).getPublicUrl(manifestPath(hash));
  const res = await fetch(data.publicUrl);
  if (!res.ok) {
    throw new ThemeStoreError(
      `Manifest fetch failed for ${hash}: ${res.status} ${res.statusText}`
    );
  }
  return (await res.json()) as Record<string, string>;
}

/** Public URL for one of a theme's assets, for the asset routes to redirect to. */
export function themeAssetUrl(
  db: SupabaseClient,
  hash: string,
  name: string
): string {
  return db.storage.from(BUCKET).getPublicUrl(assetPath(hash, name)).data.publicUrl;
}
