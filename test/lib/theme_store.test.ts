import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { config } from "dotenv";
import { zipSync } from "fflate";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";
import { ingestThemeZip, type ThemePackage } from "../../src/lib/theme_package.js";
import {
  installTheme,
  listThemes,
  activateTheme,
  deactivateAllThemes,
  deleteTheme,
  getActiveThemeRecord,
  fetchThemeManifest,
  ThemeStoreError,
} from "../../src/lib/theme_store.js";
import {
  clearThemeRuntimeCache,
  currentUploadedTheme,
  ensureThemeLoaded,
} from "../../src/lib/theme_runtime.js";

/**
 * The full drop-in path, against real Postgres and real Storage: ingest a
 * theme archive, persist it, switch to it, serve from it, switch away.
 *
 * The unit tests cover ingestion in isolation. This covers the part that can
 * only break in integration — that a theme which compiles correctly is also
 * one the running app can actually find and render.
 */

config({ path: ".env" });

const SOLARIS_DIR = join(import.meta.dirname, "..", "..", "vendor", "Solaris");

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full, base) : [relative(base, full)];
  });
}

let adminDb: SupabaseClient;
let pkg: ThemePackage;
let variantPkg: ThemePackage;

beforeAll(async () => {
  adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const entries: Record<string, Uint8Array> = {};
  for (const rel of walk(SOLARIS_DIR)) {
    entries[`Solaris/${rel.split("\\").join("/")}`] = new Uint8Array(
      readFileSync(join(SOLARIS_DIR, rel))
    );
  }
  pkg = await ingestThemeZip(zipSync(entries));

  // A second, distinct package so activation has somewhere to move to.
  variantPkg = await ingestThemeZip(
    zipSync({
      "Variant/overall_header.tpl": new TextEncoder().encode("<html><body>{PAGE_TITLE}"),
      "Variant/overall_footer.tpl": new TextEncoder().encode("</body></html>"),
      "Variant/Variant.css": new TextEncoder().encode("body{}"),
    })
  );
});

afterEach(async () => {
  // Theme state is process-wide; never leak an active theme into another test.
  await deactivateAllThemes(adminDb);
  clearThemeRuntimeCache();
});

afterAll(async () => {
  await deactivateAllThemes(adminDb);
  for (const hash of [pkg.hash, variantPkg.hash]) {
    await deleteTheme(adminDb, hash).catch(() => {});
  }
  clearThemeRuntimeCache();
});

describe("theme store", () => {
  it("installs a package and registers it without activating it", async () => {
    const record = await installTheme(adminDb, pkg);
    expect(record.theme_name).toBe("Solaris");
    expect(record.theme_hash).toBe(pkg.hash);
    // Installing must not change what visitors see.
    expect(record.is_active).toBe(false);
    expect(await getActiveThemeRecord(adminDb)).toBeNull();
  });

  it("is idempotent by content hash — re-uploading the same bytes", async () => {
    const first = await installTheme(adminDb, pkg);
    const second = await installTheme(adminDb, pkg);
    expect(second.id).toBe(first.id);
    const all = await listThemes(adminDb);
    expect(all.filter((t) => t.theme_hash === pkg.hash)).toHaveLength(1);
  });

  it("round-trips the compiled manifest through Storage", async () => {
    await installTheme(adminDb, pkg);
    const manifest = await fetchThemeManifest(adminDb, pkg.hash);
    expect(Object.keys(manifest)).toContain("overall_header.tpl");
    expect(manifest["overall_header.tpl"]).toBe(pkg.templates["overall_header.tpl"]);
  });

  it("activates a theme, and keeps at most one active", async () => {
    await installTheme(adminDb, pkg);
    await installTheme(adminDb, variantPkg);

    await activateTheme(adminDb, pkg.hash);
    expect((await getActiveThemeRecord(adminDb))!.theme_hash).toBe(pkg.hash);

    await activateTheme(adminDb, variantPkg.hash);
    const active = await getActiveThemeRecord(adminDb);
    expect(active!.theme_hash).toBe(variantPkg.hash);
    // maybeSingle() above would have thrown on two active rows; be explicit.
    expect((await listThemes(adminDb)).filter((t) => t.is_active)).toHaveLength(1);
  });

  it("refuses to activate a theme that was never installed", async () => {
    await expect(activateTheme(adminDb, "0".repeat(64))).rejects.toBeInstanceOf(
      ThemeStoreError
    );
  });

  it("refuses to delete the active theme", async () => {
    await installTheme(adminDb, pkg);
    await activateTheme(adminDb, pkg.hash);
    await expect(deleteTheme(adminDb, pkg.hash)).rejects.toThrow(/active theme/i);
  });

  it("deletes an inactive theme and its stored objects", async () => {
    await installTheme(adminDb, variantPkg);
    await deleteTheme(adminDb, variantPkg.hash);

    expect(
      (await listThemes(adminDb)).some((t) => t.theme_hash === variantPkg.hash)
    ).toBe(false);
    await expect(fetchThemeManifest(adminDb, variantPkg.hash)).rejects.toThrow();
  });
});

describe("theme runtime", () => {
  it("falls back to the bundled theme when none is active", async () => {
    clearThemeRuntimeCache();
    await ensureThemeLoaded();
    expect(currentUploadedTheme()).toBeNull();

    const res = await app.request("/");
    expect(res.status).toBe(200);
  });

  it("renders the board from an activated uploaded theme", async () => {
    await installTheme(adminDb, pkg);
    await activateTheme(adminDb, pkg.hash);
    clearThemeRuntimeCache();

    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    // Rendered through the uploaded manifest, not the filesystem.
    expect(currentUploadedTheme()?.hash).toBe(pkg.hash);
    expect(html).toContain("Plank Forum");
    expect(html).toContain("</html>");
  });

  it("serves the active theme's assets from Storage", async () => {
    await installTheme(adminDb, pkg);
    await activateTheme(adminDb, pkg.hash);
    clearThemeRuntimeCache();
    await ensureThemeLoaded();

    const res = await app.request("/templates/Solaris/Solaris.css");
    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location).toContain(`themes/${pkg.hash}/assets/Solaris.css`);

    // And the redirect target actually exists.
    const asset = await fetch(location);
    expect(asset.status).toBe(200);
  });

  it("leaves smiley images alone — they are board content, not theme content", async () => {
    await installTheme(adminDb, pkg);
    await activateTheme(adminDb, pkg.hash);
    clearThemeRuntimeCache();
    await ensureThemeLoaded();

    const res = await app.request("/images/smiles/icon_smile.gif");
    expect(res.status).not.toBe(302);
  });

  it("falls back to the bundled theme when the manifest is unfetchable", async () => {
    // A registered theme whose objects are gone must not take the board down.
    await installTheme(adminDb, variantPkg);
    await activateTheme(adminDb, variantPkg.hash);
    await adminDb.storage
      .from("theme-assets")
      .remove([`themes/${variantPkg.hash}/manifest.json`]);
    clearThemeRuntimeCache();

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(currentUploadedTheme()).toBeNull(); // degraded, not broken
  });
});
