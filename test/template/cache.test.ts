import { describe, it, expect, beforeEach } from "vitest";
import {
  Template,
  compile,
  clearTemplateCaches,
  templateCacheStats,
} from "../../src/template/engine.js";
import { markup } from "../../src/lib/markup.js";

describe("Template compile cache (Chunk 21 rung-1)", () => {
  beforeEach(() => {
    clearTemplateCaches();
  });

  it("returns the same AST instance for identical content (memoized)", () => {
    const a = compile("Hello {NAME}!");
    const b = compile("Hello {NAME}!");
    expect(a).toBe(b); // same reference — parsed once
  });

  it("parses distinct content into distinct ASTs", () => {
    const a = compile("Hello {NAME}!");
    const b = compile("Goodbye {NAME}!");
    expect(a).not.toBe(b);
    expect(templateCacheStats().astEntries).toBe(2);
  });

  it("cold parse and cached parse produce byte-identical renders", () => {
    const content = "<!-- BEGIN row -->{row.VAL}\n<!-- END row -->";

    const render = () => {
      const tpl = new Template();
      tpl.loadString("t", content);
      tpl.assignBlockVars("row", { VAL: "a" });
      tpl.assignBlockVars("row", { VAL: "b" });
      return tpl.render("t");
    };

    clearTemplateCaches();
    const cold = render(); // miss → parse
    const warm = render(); // hit → cached AST
    expect(warm).toBe(cold);
    expect(cold).toBe("a\nb\n");
  });

  it("shared cached AST is not corrupted across instances with different data", () => {
    const content = "<!-- BEGIN row -->[{row.VAL}]<!-- END row -->";

    const t1 = new Template();
    t1.loadString("t", content);
    t1.assignBlockVars("row", { VAL: "one" });

    const t2 = new Template();
    t2.loadString("t", content); // same content → same cached AST
    t2.assignBlockVars("row", { VAL: "two" });
    t2.assignBlockVars("row", { VAL: "three" });

    // Render order must not let one instance's data leak into the other.
    expect(t2.render("t")).toBe("[two][three]");
    expect(t1.render("t")).toBe("[one]");
    expect(t1.render("t")).toBe("[one]"); // re-render stable
  });

  it("escaping behavior is preserved through the cache", () => {
    const t1 = new Template();
    t1.loadString("t", "{X}");
    t1.assignVars({ X: "<b>" });
    expect(t1.render("t")).toBe("&lt;b&gt;");

    const t2 = new Template();
    t2.loadString("t", "{X}"); // cached AST
    t2.assignVars({ X: markup("<b>") });
    expect(t2.render("t")).toBe("<b>");
  });

  it("clearTemplateCaches resets the AST cache", () => {
    compile("a {X}");
    expect(templateCacheStats().astEntries).toBeGreaterThan(0);
    clearTemplateCaches();
    expect(templateCacheStats().astEntries).toBe(0);
  });
});
