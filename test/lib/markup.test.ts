import { describe, it, expect } from "vitest";
import { markup, isMarkup, MarkupString } from "../../src/lib/markup.js";
import { Template } from "../../src/template/engine.js";

describe("markup()", () => {
  it("returns a MarkupString instance carrying the html", () => {
    const m = markup("<b>x</b>");
    expect(m).toBeInstanceOf(MarkupString);
    expect(m.html).toBe("<b>x</b>");
  });

  it("toString returns the underlying html", () => {
    expect(String(markup("<i>y</i>"))).toBe("<i>y</i>");
  });
});

describe("isMarkup", () => {
  it("true for MarkupString, false for everything else", () => {
    expect(isMarkup(markup("a"))).toBe(true);
    expect(isMarkup("a")).toBe(false);
    expect(isMarkup(42)).toBe(false);
    expect(isMarkup(null)).toBe(false);
    expect(isMarkup(undefined)).toBe(false);
    expect(isMarkup({ html: "x" })).toBe(false);
  });
});

describe("Template substitution accepts markup() values (chunk 4a)", () => {
  it("renders a MarkupString verbatim, identical to a raw string", () => {
    const tplPlain = new Template();
    tplPlain.loadString("body", "x{V}y");
    tplPlain.assignVars({ V: "<b>raw</b>" });

    const tplMarkup = new Template();
    tplMarkup.loadString("body", "x{V}y");
    tplMarkup.assignVars({ V: markup("<b>raw</b>") });

    expect(tplMarkup.render("body")).toBe(tplPlain.render("body"));
    expect(tplMarkup.render("body")).toBe("x<b>raw</b>y");
  });

  it("works inside block iterations", () => {
    const tpl = new Template();
    tpl.loadString(
      "body",
      "<!-- BEGIN row -->[{row.HTML}]<!-- END row -->"
    );
    tpl.assignBlockVars("row", { HTML: markup("<i>1</i>") });
    tpl.assignBlockVars("row", { HTML: markup("<i>2</i>") });
    expect(tpl.render("body")).toBe("[<i>1</i>][<i>2</i>]");
  });
});
