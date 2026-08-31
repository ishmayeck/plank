import { describe, it, expect, beforeAll } from "vitest";
import { zipSync } from "fflate";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ingestThemeZip } from "../../src/lib/theme_package.js";
import { Template, clearTemplateCaches } from "../../src/template/engine.js";
import { PrecompiledTemplateLoader } from "../../src/template/loader.js";

/**
 * The Chunk 23 acceptance test: take a REAL, unmodified phpBB2 theme, package
 * it the way a third party would ship it (everything under a directory named
 * after the theme), and drive it through the whole pipeline — zip → harden →
 * unzip → compile → render.
 *
 * The synthetic fixtures in theme_package.test.ts cover the hardening rules
 * with hand-built archives. This one exists because those archives are all
 * shaped the way I expected an archive to be shaped, and the point of the
 * feature is themes I did NOT build.
 */

const SOLARIS_DIR = join(import.meta.dirname, "..", "..", "vendor", "Solaris");

/** Every file under `dir`, as paths relative to it. */
function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full, base) : [relative(base, full)];
  });
}

let solarisZip: Uint8Array;
let fileCount = 0;

beforeAll(() => {
  // Package it as a distributor would: wrapped in a "Solaris/" directory.
  const entries: Record<string, Uint8Array> = {};
  for (const rel of walk(SOLARIS_DIR)) {
    entries[`Solaris/${rel.split("\\").join("/")}`] = new Uint8Array(
      readFileSync(join(SOLARIS_DIR, rel))
    );
    fileCount++;
  }
  solarisZip = zipSync(entries);
});

describe("drop-in ingestion of the real Solaris theme", () => {
  it("has a non-trivial fixture to work with", () => {
    // Guards the rest of the file against silently testing an empty archive.
    expect(fileCount).toBeGreaterThan(40);
  });

  it("detects the theme name from the archive's root directory", async () => {
    const pkg = await ingestThemeZip(solarisZip);
    expect(pkg.name).toBe("Solaris");
  });

  it("compiles every .tpl in the theme, addressable by bare name", async () => {
    const pkg = await ingestThemeZip(solarisZip);
    const names = Object.keys(pkg.templates);

    // The templates the app actually loads by name must all be present.
    for (const required of [
      "overall_header.tpl",
      "overall_footer.tpl",
      "index_body.tpl",
      "viewforum_body.tpl",
      "viewtopic_body.tpl",
      "posting_body.tpl",
      "login_body.tpl",
      "profile_view_body.tpl",
      "memberlist_body.tpl",
      "search_body.tpl",
    ]) {
      expect(names, `missing ${required}`).toContain(required);
    }
    expect(names.length).toBeGreaterThan(30);
  });

  it("keeps the theme's stylesheet and images as assets", async () => {
    const pkg = await ingestThemeZip(solarisZip);
    expect(pkg.assetNames).toContain("Solaris.css");
    expect(pkg.assetNames.some((n) => n.startsWith("images/"))).toBe(true);
    // Nothing executable survived the allowlist.
    expect(pkg.assetNames.some((n) => n.endsWith(".js"))).toBe(false);
    expect(pkg.assetNames.some((n) => n.endsWith(".php"))).toBe(false);
  });

  it("renders the ingested header byte-identically to the on-disk theme", async () => {
    // The real proof: an uploaded theme must render exactly what the
    // filesystem theme renders, or "drop-in" means "drop-in and then debug".
    clearTemplateCaches();
    const pkg = await ingestThemeZip(solarisZip);

    const vars = {
      PAGE_TITLE: "Plank Forum :: Index",
      SITENAME: "Plank Forum",
      SITE_DESCRIPTION: "A board",
      T_HEAD_STYLESHEET: "Solaris.css",
      T_BODY_BGCOLOR: "#E5E5E5",
      T_BODY_TEXT: "#000000",
      T_BODY_LINK: "#006699",
      T_BODY_VLINK: "#5493B4",
      S_CONTENT_DIRECTION: "ltr",
      S_CONTENT_ENCODING: "utf-8",
      S_TIMEZONE: "All times are GMT",
      U_INDEX: "/",
      L_INDEX: "Index",
      L_SEARCH: "Search",
      L_FAQ: "FAQ",
      L_MEMBERLIST: "Memberlist",
      L_USERGROUPS: "Usergroups",
      L_PROFILE: "Profile",
      L_REGISTER: "Register",
      L_LOGIN_LOGOUT: "Log in",
      U_SEARCH: "/search",
      U_FAQ: "/faq",
      U_MEMBERLIST: "/memberlist",
      U_GROUP_CP: "/groupcp",
      U_PROFILE: "/profile",
      U_REGISTER: "/register",
      U_LOGIN_LOGOUT: "/login",
      PRIVATE_MESSAGE_INFO: "",
    };

    const fromUpload = new Template(new PrecompiledTemplateLoader(pkg.templates));
    fromUpload.loadFile("h", "overall_header.tpl");
    fromUpload.assignVars(vars);
    fromUpload.assignBlockVars("switch_user_logged_out", {});

    const fromDisk = new Template(SOLARIS_DIR);
    fromDisk.loadFile("h", "overall_header.tpl");
    fromDisk.assignVars(vars);
    fromDisk.assignBlockVars("switch_user_logged_out", {});

    const uploaded = fromUpload.render("h");
    expect(uploaded).toBe(fromDisk.render("h"));
    expect(uploaded).toContain("Plank Forum :: Index");
  });

  it("still escapes by default when rendering an uploaded theme", async () => {
    // An uploaded theme must not be able to opt out of the engine's escaping
    // for the data we put through it.
    const pkg = await ingestThemeZip(solarisZip);
    const tpl = new Template(new PrecompiledTemplateLoader(pkg.templates));
    tpl.loadFile("h", "overall_header.tpl");
    tpl.assignVars({ SITENAME: "<script>alert(1)</script>", PAGE_TITLE: "x" });
    tpl.assignBlockVars("switch_user_logged_out", {});
    const html = tpl.render("h");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("is content-addressed, so a re-upload of the same bytes matches", async () => {
    const a = await ingestThemeZip(solarisZip);
    const b = await ingestThemeZip(solarisZip);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
