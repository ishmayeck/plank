import { Hono } from "hono";
import { getSupabaseAdmin } from "../db/client.js";
import { isAdmin } from "../lib/userLevel.js";
import { escapeHtml } from "../lib/escape.js";
import { renderAdminPage } from "../lib/adminLayout.js";
import { formHiddenFields, validateQueryCsrf, csrfQueryParam } from "../lib/csrf.js";
import { ingestThemeZip, ThemePackageError } from "../lib/theme_package.js";
import {
  installTheme,
  listThemes,
  activateTheme,
  deactivateAllThemes,
  deleteTheme,
  ThemeStoreError,
  type ThemeRecord,
} from "../lib/theme_store.js";
import { clearThemeRuntimeCache } from "../lib/theme_runtime.js";
import type { Context } from "hono";

/**
 * Theme administration (Chunk 23).
 *
 * Upload a phpBB2 theme `.zip`, switch the board to it, remove it again. The
 * dangerous part — turning untrusted archive bytes into something renderable —
 * is entirely in ingestThemeZip; this module is the UI over it plus the
 * service-role calls that persist the result.
 *
 * Built with the Plank admin chrome rather than a phpBB2 template: there is no
 * phpBB2 original for "manage uploaded themes", since phpBB2 themes were
 * installed by unzipping into the webroot.
 *
 * NOTE on trust: an uploaded theme's `.tpl` files become the page's own HTML.
 * The AST is inert data, so a theme cannot execute anything server-side, and
 * escape-by-default still protects every value Plank substitutes INTO it — but
 * literal `<script>` in a template is emitted verbatim, because that is what a
 * template is. Installing a theme is therefore an admin-only, full-trust act,
 * equivalent to granting site-wide script execution. The UI says so.
 */

const adminThemes = new Hono();

/** 20 MiB: comfortably above any real phpBB2 theme, well below a memory risk. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

function renderThemesPage(
  c: Context,
  themes: ThemeRecord[],
  message?: { kind: "error" | "ok"; text: string }
): string {
  const banner = message
    ? `<div class="plank-admin-note plank-admin-note-${message.kind}">${escapeHtml(
        message.text
      )}</div>`
    : "";

  const rows = themes.length
    ? themes
        .map((t) => {
          const installed = new Date(t.installed_at).toISOString().slice(0, 10);
          const actions = t.is_active
            ? `<a href="/admin/themes/action?mode=deactivate&amp;${csrfQueryParam(c)}">Revert to bundled theme</a>`
            : `<a href="/admin/themes/action?mode=activate&amp;hash=${encodeURIComponent(
                t.theme_hash
              )}&amp;${csrfQueryParam(c)}">Activate</a>` +
              ` &nbsp;|&nbsp; ` +
              `<a href="/admin/themes/action?mode=delete&amp;hash=${encodeURIComponent(
                t.theme_hash
              )}&amp;${csrfQueryParam(c)}">Delete</a>`;
          return (
            `<tr>` +
            `<td>${escapeHtml(t.theme_name)}${
              t.is_active ? ` <strong>(active)</strong>` : ""
            }</td>` +
            `<td><code>${escapeHtml(shortHash(t.theme_hash))}</code></td>` +
            `<td>${escapeHtml(installed)}</td>` +
            `<td>${actions}</td>` +
            `</tr>`
          );
        })
        .join("")
    : `<tr><td colspan="4"><em>No themes uploaded. The board is using the bundled Solaris theme.</em></td></tr>`;

  const body =
    `<h1>Themes</h1>` +
    banner +
    `<table class="plank-admin-table" width="100%" cellpadding="4" cellspacing="1">` +
    `<tr><th>Name</th><th>Version</th><th>Installed</th><th>Actions</th></tr>` +
    rows +
    `</table>` +
    `<h2>Upload a theme</h2>` +
    `<p>A phpBB2 theme <code>.zip</code>. Templates are compiled on upload; ` +
    `scripts and other executable files are discarded.</p>` +
    `<p><strong>Only install themes you trust.</strong> A theme supplies the ` +
    `board's HTML, so it can include scripts that run for every visitor. It ` +
    `cannot run anything on the server, and it cannot bypass the escaping ` +
    `applied to posts and usernames.</p>` +
    `<form method="post" action="/admin/themes" enctype="multipart/form-data">` +
    formHiddenFields(c).html +
    `<p><input type="file" name="theme" accept=".zip,application/zip" /></p>` +
    `<p><input type="submit" value="Upload theme" class="mainoption" /></p>` +
    `</form>`;

  return renderAdminPage({
    title: "Plank Forum :: Themes",
    currentUrl: "/admin/themes",
    body,
  });
}

adminThemes.get("/admin/themes", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const db = getSupabaseAdmin();
  return c.html(renderThemesPage(c, await listThemes(db)));
});

adminThemes.post("/admin/themes", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const db = getSupabaseAdmin();
  const body = await c.req.parseBody();
  const file = body.theme as File | undefined;

  const fail = async (text: string) =>
    c.html(renderThemesPage(c, await listThemes(db), { kind: "error", text }));

  if (!file || file.size === 0) return fail("Please choose a .zip file to upload.");
  if (file.size > MAX_UPLOAD_BYTES) {
    return fail(
      `That file is ${Math.round(file.size / 1024 / 1024)} MB; the limit is ` +
        `${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`
    );
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Name the theme after the uploaded file when the archive has no root
    // directory to take a name from.
    const fallbackName = (file.name ?? "theme").replace(/\.zip$/i, "") || "Uploaded";
    const pkg = await ingestThemeZip(bytes, { fallbackName });
    const record = await installTheme(db, pkg);

    return c.html(
      renderThemesPage(c, await listThemes(db), {
        kind: "ok",
        text:
          `Installed "${record.theme_name}" (${
            Object.keys(pkg.templates).length
          } templates, ${pkg.assetNames.length} assets). ` +
          `Activate it to switch the board over.`,
      })
    );
  } catch (err) {
    if (err instanceof ThemePackageError || err instanceof ThemeStoreError) {
      return fail(err.message);
    }
    console.error("[admin/themes] upload failed:", err);
    return fail("The upload could not be processed. Is it a valid .zip archive?");
  }
});

/**
 * Activate / deactivate / delete. These are links in the table above rather
 * than forms, so they mutate on GET and carry the CSRF token in the query
 * string — see validateQueryCsrf.
 */
adminThemes.get("/admin/themes/action", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);
  if (!validateQueryCsrf(c)) return c.text("CSRF token mismatch", 403);

  const db = getSupabaseAdmin();
  const mode = c.req.query("mode");
  const hash = c.req.query("hash") ?? "";

  try {
    if (mode === "activate") {
      await activateTheme(db, hash);
    } else if (mode === "deactivate") {
      await deactivateAllThemes(db);
    } else if (mode === "delete") {
      await deleteTheme(db, hash);
    } else {
      return c.redirect("/admin/themes");
    }
  } catch (err) {
    const text =
      err instanceof ThemeStoreError
        ? err.message
        : "That action could not be completed.";
    if (!(err instanceof ThemeStoreError)) {
      console.error("[admin/themes] action failed:", err);
    }
    return c.html(renderThemesPage(c, await listThemes(db), { kind: "error", text }));
  }

  // The active theme drives the renderer through a module-level cache; without
  // this the switch would not take effect until the process restarted.
  clearThemeRuntimeCache();
  return c.redirect("/admin/themes");
});

export default adminThemes;
