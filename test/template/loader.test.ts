import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import {
  Template,
  compile,
  serializeAst,
  deserializeAst,
  clearTemplateCaches,
  AST_FORMAT_VERSION,
} from "../../src/template/engine.js";
import {
  FsTemplateLoader,
  MemoryTemplateLoader,
  PrecompiledTemplateLoader,
} from "../../src/template/loader.js";
import { markup } from "../../src/lib/markup.js";

const SOLARIS_DIR = join(import.meta.dirname, "..", "..", "vendor", "Solaris");

describe("TemplateLoader (Chunk 21 rung-2)", () => {
  beforeEach(() => clearTemplateCaches());

  describe("AST serialization", () => {
    it("round-trips an AST through serialize/deserialize", () => {
      const nodes = compile(
        "Hi {NAME}<!-- BEGIN row -->[{row.X}]<!-- END row -->end"
      );
      const json = serializeAst(nodes);
      const back = deserializeAst(json);
      expect(back).toEqual(nodes);
    });

    it("tags output with the format version", () => {
      const json = serializeAst(compile("x"));
      expect(JSON.parse(json).v).toBe(AST_FORMAT_VERSION);
    });

    it("rejects a version mismatch instead of mis-rendering", () => {
      const bad = JSON.stringify({ v: AST_FORMAT_VERSION + 99, nodes: [] });
      expect(() => deserializeAst(bad)).toThrow(/format mismatch/i);
    });
  });

  describe("MemoryTemplateLoader", () => {
    it("renders a template resolved from in-memory strings", () => {
      const loader = new MemoryTemplateLoader({
        "greet.tpl": "Hello, {NAME}!",
      });
      const tpl = new Template(loader);
      tpl.loadFile("body", "greet.tpl");
      tpl.assignVars({ NAME: "Lem" });
      expect(tpl.render("body")).toBe("Hello, Lem!");
    });

    it("throws for an unknown template name", () => {
      const tpl = new Template(new MemoryTemplateLoader());
      expect(() => tpl.loadFile("body", "missing.tpl")).toThrow(/no template/i);
    });
  });

  describe("FsTemplateLoader", () => {
    it("resolves + renders a real Solaris template", () => {
      const tpl = new Template(new FsTemplateLoader(SOLARIS_DIR));
      tpl.loadFile("footer", "overall_footer.tpl");
      expect(tpl.render("footer")).toContain("</html>");
    });

    it("produces byte-identical output to the path-based constructor", () => {
      const viaPath = new Template(SOLARIS_DIR);
      viaPath.loadFile("footer", "overall_footer.tpl");

      const viaLoader = new Template(new FsTemplateLoader(SOLARIS_DIR));
      viaLoader.loadFile("footer", "overall_footer.tpl");

      expect(viaLoader.render("footer")).toBe(viaPath.render("footer"));
    });
  });

  describe("PrecompiledTemplateLoader — the runtime-agnostic path", () => {
    it("renders from precompiled AST JSON with NO filesystem access", () => {
      // Simulate a build step: compile to AST JSON.
      const serialized = {
        "body.tpl": serializeAst(
          compile(
            "<!-- BEGIN post -->{post.AUTHOR}: {post.MSG}\n<!-- END post -->"
          )
        ),
      };

      // Simulate the server: hydrate from JSON, render. No readFileSync.
      const loader = new PrecompiledTemplateLoader(serialized);
      const tpl = new Template(loader);
      tpl.loadFile("body", "body.tpl");
      tpl.assignBlockVars("post", { AUTHOR: "Lem", MSG: "Hi" });
      tpl.assignBlockVars("post", { AUTHOR: "Kelvin", MSG: "Yo" });

      expect(tpl.render("body")).toBe("Lem: Hi\nKelvin: Yo\n");
    });

    it("matches filesystem rendering byte-for-byte (portability proof)", () => {
      // Render a real Solaris template both ways and compare.
      const fsTpl = new Template(SOLARIS_DIR);
      fsTpl.loadFile("err", "error_body.tpl");
      fsTpl.assignVars({ ERROR_MESSAGE: "Boom <x>" });
      const fsOut = fsTpl.render("err");

      // Build → serialize → ship → hydrate → render.
      const ast = compile(
        // read once at "build time" using the fs loader
        new FsTemplateLoaderProbe(SOLARIS_DIR).read("error_body.tpl")
      );
      const loader = new PrecompiledTemplateLoader({
        "error_body.tpl": serializeAst(ast),
      });
      const preTpl = new Template(loader);
      preTpl.loadFile("err", "error_body.tpl");
      preTpl.assignVars({ ERROR_MESSAGE: "Boom <x>" });

      expect(preTpl.render("err")).toBe(fsOut);
    });

    it("preserves escape-by-default through the precompiled path", () => {
      const loader = new PrecompiledTemplateLoader({
        "t.tpl": serializeAst(compile("{X}")),
      });
      const tEsc = new Template(loader);
      tEsc.loadFile("t", "t.tpl");
      tEsc.assignVars({ X: "<script>" });
      expect(tEsc.render("t")).toBe("&lt;script&gt;");

      const tRaw = new Template(loader);
      tRaw.loadFile("t", "t.tpl");
      tRaw.assignVars({ X: markup("<b>") });
      expect(tRaw.render("t")).toBe("<b>");
    });

    it("throws if a template was not primed", () => {
      const tpl = new Template(new PrecompiledTemplateLoader());
      expect(() => tpl.loadFile("body", "nope.tpl")).toThrow(/not loaded/i);
    });
  });

  describe("Template.loadAst", () => {
    it("renders a directly-loaded AST", () => {
      const tpl = new Template();
      tpl.loadAst("body", compile("Direct {VAL}"));
      tpl.assignVars({ VAL: "AST" });
      expect(tpl.render("body")).toBe("Direct AST");
    });
  });
});

// Tiny helper to read a raw template at "build time" without coupling the
// test to FsTemplateLoader internals (which return ASTs, not strings).
import { readFileSync } from "node:fs";
class FsTemplateLoaderProbe {
  constructor(private root: string) {}
  read(name: string): string {
    return readFileSync(join(this.root, name), "utf-8");
  }
}
