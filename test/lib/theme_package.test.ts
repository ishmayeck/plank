import { describe, it, expect, beforeEach } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  ingestThemeZip,
  ThemePackageError,
} from "../../src/lib/theme_package.js";
import { Template, clearTemplateCaches } from "../../src/template/engine.js";
import { PrecompiledTemplateLoader } from "../../src/template/loader.js";

/** Build a zip Uint8Array from a {name: stringContent} map. */
function makeZip(files: Record<string, string | Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    entries[name] = typeof content === "string" ? strToU8(content) : content;
  }
  return zipSync(entries);
}

describe("ingestThemeZip (Chunk 23 — drop-in themes)", () => {
  beforeEach(() => clearTemplateCaches());

  it("compiles .tpl files and keeps allowed assets", async () => {
    const zip = makeZip({
      "overall_header.tpl": "<html>{PAGE_TITLE}</html>",
      "index_body.tpl": "<!-- BEGIN row -->{row.X}<!-- END row -->",
      "Theme.css": "body { color: red; }",
      "images/logo.gif": new Uint8Array([0x47, 0x49, 0x46]), // "GIF"
    });

    const pkg = await ingestThemeZip(zip);

    expect(Object.keys(pkg.templates).sort()).toEqual([
      "index_body.tpl",
      "overall_header.tpl",
    ]);
    expect(pkg.assetNames).toEqual(["Theme.css", "images/logo.gif"]);
    expect(pkg.hash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it("a compiled template renders identically to a direct compile", async () => {
    const zip = makeZip({
      "body.tpl": "<!-- BEGIN row -->[{row.NAME}]<!-- END row -->",
    });
    const pkg = await ingestThemeZip(zip);

    const loader = new PrecompiledTemplateLoader(pkg.templates);
    const tpl = new Template(loader);
    tpl.loadFile("body", "body.tpl");
    tpl.assignBlockVars("row", { NAME: "a" });
    tpl.assignBlockVars("row", { NAME: "b" });
    expect(tpl.render("body")).toBe("[a][b]");
  });

  it("preserves escape-by-default through the ingested template", async () => {
    const zip = makeZip({ "t.tpl": "{X}" });
    const pkg = await ingestThemeZip(zip);
    const tpl = new Template(new PrecompiledTemplateLoader(pkg.templates));
    tpl.loadFile("t", "t.tpl");
    tpl.assignVars({ X: "<script>alert(1)</script>" });
    expect(tpl.render("t")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("is content-addressed: same bytes → same hash, different → different", async () => {
    const a = makeZip({ "x.tpl": "A" });
    const b = makeZip({ "x.tpl": "A" });
    const c = makeZip({ "x.tpl": "B" });
    const [pa, pb, pc] = await Promise.all([
      ingestThemeZip(a),
      ingestThemeZip(b),
      ingestThemeZip(c),
    ]);
    expect(pa.hash).toBe(pb.hash);
    expect(pa.hash).not.toBe(pc.hash);
  });

  describe("hardening", () => {
    it("rejects zip-slip entry names (../)", async () => {
      const zip = makeZip({
        "ok.tpl": "x",
        "../../etc/passwd": "pwned",
      });
      await expect(ingestThemeZip(zip)).rejects.toBeInstanceOf(ThemePackageError);
      await expect(ingestThemeZip(zip)).rejects.toThrow(/zip-slip|unsafe/i);
    });

    it("skips disallowed extensions (.js, .php) silently", async () => {
      const zip = makeZip({
        "good.tpl": "x",
        "evil.js": "alert(document.cookie)",
        "shell.php": "<?php system($_GET['c']); ?>",
        "readme.txt": "hi",
      });
      const pkg = await ingestThemeZip(zip);
      expect(Object.keys(pkg.templates)).toEqual(["good.tpl"]);
      expect(pkg.assetNames).toEqual([]); // js/php/txt all dropped
    });

    it("rejects an archive with no templates", async () => {
      const zip = makeZip({ "only.css": "body{}" });
      await expect(ingestThemeZip(zip)).rejects.toThrow(/no \.tpl/i);
    });

    it("enforces the per-entry size cap (zip-bomb)", async () => {
      const big = "x".repeat(2000);
      const zip = makeZip({ "a.tpl": "ok", "big.css": big });
      await expect(
        ingestThemeZip(zip, { maxEntryBytes: 1000 })
      ).rejects.toThrow(/too large/i);
    });

    it("enforces the total size cap (zip-bomb)", async () => {
      const zip = makeZip({
        "a.tpl": "x".repeat(600),
        "b.css": "y".repeat(600),
      });
      await expect(
        ingestThemeZip(zip, { maxTotalBytes: 1000 })
      ).rejects.toThrow(/too large/i);
    });

    it("enforces the entry-count cap", async () => {
      const files: Record<string, string> = { "a.tpl": "x" };
      for (let i = 0; i < 10; i++) files[`f${i}.css`] = "y";
      await expect(
        ingestThemeZip(makeZip(files), { maxEntries: 5 })
      ).rejects.toThrow(/too many entries/i);
    });

    it("rejects non-zip input", async () => {
      const notAZip = strToU8("this is plainly not a zip file at all");
      await expect(ingestThemeZip(notAZip)).rejects.toThrow(/valid zip/i);
    });
  });
});
