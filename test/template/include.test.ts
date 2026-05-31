import { describe, it, expect, beforeEach } from "vitest";
import {
  Template,
  compile,
  serializeAst,
  deserializeAst,
  clearTemplateCaches,
} from "../../src/template/engine.js";
import { MemoryTemplateLoader } from "../../src/template/loader.js";
import { markup } from "../../src/lib/markup.js";

describe("INCLUDE directive (Chunk 21)", () => {
  beforeEach(() => clearTemplateCaches());

  it("inlines another template at render time", () => {
    const loader = new MemoryTemplateLoader({
      "header.tpl": "<head>{TITLE}</head>",
      "body.tpl": "<!-- INCLUDE header.tpl -->\n<p>body</p>",
    });
    const tpl = new Template(loader);
    tpl.loadFile("body", "body.tpl");
    tpl.assignVars({ TITLE: "Plank" });
    expect(tpl.render("body")).toBe("<head>Plank</head>\n<p>body</p>");
  });

  it("shares the variable namespace with the includer", () => {
    const loader = new MemoryTemplateLoader({
      "partial.tpl": "[{SHARED}]",
      "main.tpl": "A<!-- INCLUDE partial.tpl -->B",
    });
    const tpl = new Template(loader);
    tpl.loadFile("main", "main.tpl");
    tpl.assignVars({ SHARED: "x" });
    expect(tpl.render("main")).toBe("A[x]B");
  });

  it("resolves an INCLUDE placed inside a block, with block scope", () => {
    const loader = new MemoryTemplateLoader({
      "row.tpl": "<{row.NAME}>",
      "list.tpl":
        "<!-- BEGIN row --><!-- INCLUDE row.tpl --><!-- END row -->",
    });
    const tpl = new Template(loader);
    tpl.loadFile("list", "list.tpl");
    tpl.assignBlockVars("row", { NAME: "a" });
    tpl.assignBlockVars("row", { NAME: "b" });
    expect(tpl.render("list")).toBe("<a><b>");
  });

  it("resolves nested includes (A → B → C)", () => {
    const loader = new MemoryTemplateLoader({
      "c.tpl": "C",
      "b.tpl": "B<!-- INCLUDE c.tpl -->",
      "a.tpl": "A<!-- INCLUDE b.tpl -->",
    });
    const tpl = new Template(loader);
    tpl.loadFile("a", "a.tpl");
    expect(tpl.render("a")).toBe("ABC");
  });

  it("handles multiple includes in one template", () => {
    const loader = new MemoryTemplateLoader({
      "h.tpl": "H",
      "f.tpl": "F",
      "page.tpl": "<!-- INCLUDE h.tpl -->mid<!-- INCLUDE f.tpl -->",
    });
    const tpl = new Template(loader);
    tpl.loadFile("page", "page.tpl");
    expect(tpl.render("page")).toBe("HmidF");
  });

  it("detects an include cycle instead of looping forever", () => {
    const loader = new MemoryTemplateLoader({
      "a.tpl": "A<!-- INCLUDE b.tpl -->",
      "b.tpl": "B<!-- INCLUDE a.tpl -->",
    });
    const tpl = new Template(loader);
    tpl.loadFile("a", "a.tpl");
    expect(() => tpl.render("a")).toThrow(/cycle/i);
  });

  it("escapes plain values inside an included template", () => {
    const loader = new MemoryTemplateLoader({
      "danger.tpl": "{EVIL}",
      "wrap.tpl": "<!-- INCLUDE danger.tpl -->",
    });
    const tpl = new Template(loader);
    tpl.loadFile("wrap", "wrap.tpl");
    tpl.assignVars({ EVIL: "<script>" });
    expect(tpl.render("wrap")).toBe("&lt;script&gt;");
  });

  it("round-trips include nodes through AST serialization", () => {
    const ast = compile("x<!-- INCLUDE p.tpl -->y");
    expect(ast).toContainEqual({ type: "include", name: "p.tpl" });
    const back = deserializeAst(serializeAst(ast));
    expect(back).toEqual(ast);
  });

  it("works through a precompiled loader (no parsing at render)", () => {
    // Build step: compile each template to AST JSON.
    const serialized = {
      "header.tpl": serializeAst(compile("HEAD")),
      "body.tpl": serializeAst(compile("<!-- INCLUDE header.tpl -->|tail")),
    };
    // Server: a Precompiled-style loader returning ASTs from JSON.
    const loader = new MemoryTemplateLoader();
    // Use deserialize to hydrate, then a tiny adapter loader:
    const astByName = new Map(
      Object.entries(serialized).map(([n, j]) => [n, deserializeAst(j)])
    );
    const adapter = {
      resolve: (name: string) => {
        const a = astByName.get(name);
        if (!a) throw new Error(`missing ${name}`);
        return a;
      },
    };
    void loader;
    const tpl = new Template(adapter);
    tpl.loadFile("body", "body.tpl");
    expect(tpl.render("body")).toBe("HEAD|tail");
  });
});
