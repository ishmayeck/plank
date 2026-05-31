import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { compileTheme } from "../../scripts/compile-theme.js";
import { Template, clearTemplateCaches } from "../../src/template/engine.js";
import { PrecompiledTemplateLoader } from "../../src/template/loader.js";

const SOLARIS_DIR = join(import.meta.dirname, "..", "..", "vendor", "Solaris");

/**
 * End-to-end proof of the deploy path: compile the REAL Solaris theme to an
 * AST-JSON manifest, hydrate a PrecompiledTemplateLoader from it, and confirm
 * a Template renders byte-for-byte the same as reading the .tpl from disk —
 * with no filesystem access at render time.
 */
describe("theme compiler → precompiled loader (deploy path)", () => {
  beforeEach(() => clearTemplateCaches());

  it("compiles every Solaris .tpl into the manifest", () => {
    const manifest = compileTheme(SOLARIS_DIR);
    const names = Object.keys(manifest);
    expect(names.length).toBeGreaterThan(40);
    // Spot-check a few well-known templates (top-level + admin subdir).
    expect(names).toContain("overall_header.tpl");
    expect(names).toContain("index_body.tpl");
    expect(names.some((n) => n.startsWith("admin/"))).toBe(true);
    // Every value is serialized AST JSON tagged with the format version.
    for (const json of Object.values(manifest)) {
      expect(JSON.parse(json)).toHaveProperty("v");
      expect(JSON.parse(json)).toHaveProperty("nodes");
    }
  });

  it("renders a real template identically from manifest vs filesystem", () => {
    const manifest = compileTheme(SOLARIS_DIR);

    // Filesystem render.
    const fsTpl = new Template(SOLARIS_DIR);
    fsTpl.loadFile("err", "error_body.tpl");
    fsTpl.assignVars({ ERROR_MESSAGE: "Boom <x> & 'stuff'" });
    const fsOut = fsTpl.render("err");

    // Precompiled render — no fs touched at render time.
    const loader = new PrecompiledTemplateLoader(manifest);
    const preTpl = new Template(loader);
    preTpl.loadFile("err", "error_body.tpl");
    preTpl.assignVars({ ERROR_MESSAGE: "Boom <x> & 'stuff'" });
    const preOut = preTpl.render("err");

    expect(preOut).toBe(fsOut);
  });

  it("renders a header+blocks template identically through the manifest", () => {
    const manifest = compileTheme(SOLARIS_DIR);
    const loader = new PrecompiledTemplateLoader(manifest);

    const build = (t: Template) => {
      t.loadFile("body", "index_body.tpl");
      t.assignVars({
        L_FORUM: "Forum", L_TOPICS: "Topics", L_POSTS: "Posts",
        L_LASTPOST: "Last Post", U_INDEX: "/", L_INDEX: "Index",
      });
      t.assignBlockVars("catrow", { CAT_DESC: "General <General>" });
      t.assignBlockVars("catrow.forumrow", { FORUM_NAME: "Chat & Stuff", FORUM_DESC: "d" });
      return t.render("body");
    };

    const fsOut = build(new Template(SOLARIS_DIR));
    clearTemplateCaches();
    const preOut = build(new Template(loader));
    expect(preOut).toBe(fsOut);
  });
});
