import { describe, it, expect } from "vitest";
import { Template } from "../../src/template/engine.js";
import { markup } from "../../src/lib/markup.js";

/**
 * Escape-by-default is the invariant the whole design rests on (CLAUDE.md,
 * ROADMAP Chunk 24): a plain string assigned to a template variable can never
 * introduce markup or template syntax. escapeHtml deliberately does not touch
 * `{` or `}`, so the guarantee depends entirely on substitution being a single
 * pass — a second pass over the first pass's output would let user content
 * name and expand root variables.
 *
 * These tests pin that down. They are regression coverage for a real bug: the
 * engine ran namespaced substitution and then root substitution over its
 * result, so a post body of `{S_HIDDEN_FIELDS}` printed the viewer's CSRF
 * token and `{S_TOPIC_ADMIN}` rendered forged moderator controls.
 */
describe("substitution safety — user content cannot expand template variables", () => {
  it("does not expand a root variable named inside a block variable", () => {
    const tpl = new Template();
    tpl.loadString("body", "<!-- BEGIN postrow -->[{postrow.MESSAGE}]<!-- END postrow -->");
    tpl.assignVars({ SECRET: markup('<input name="_csrf" value="TOKEN" />') });
    tpl.assignBlockVars("postrow", { MESSAGE: "user text {SECRET} here" });

    const out = tpl.render("body");
    expect(out).toBe("[user text {SECRET} here]");
    expect(out).not.toContain("_csrf");
    expect(out).not.toContain("TOKEN");
  });

  it("does not expand a root variable named inside a root variable", () => {
    const tpl = new Template();
    tpl.loadString("body", "[{TITLE}]");
    tpl.assignVars({
      TITLE: "topic {SECRET} title",
      SECRET: markup("<b>leaked</b>"),
    });

    const out = tpl.render("body");
    expect(out).toBe("[topic {SECRET} title]");
    expect(out).not.toContain("leaked");
  });

  it("does not expand a block variable named inside a block variable", () => {
    const tpl = new Template();
    tpl.loadString("body", "<!-- BEGIN row -->{row.A}|{row.B}<!-- END row -->");
    tpl.assignBlockVars("row", { A: "{row.B}", B: "plain" });

    const out = tpl.render("body");
    expect(out).toBe("{row.B}|plain");
  });

  it("still expands genuine placeholders written by the template author", () => {
    const tpl = new Template();
    tpl.loadString(
      "body",
      "{HEADER}<!-- BEGIN row -->{row.NAME} in {FORUM}<!-- END row -->{FOOTER}"
    );
    tpl.assignVars({ HEADER: "H:", FORUM: "Chat", FOOTER: ":F" });
    tpl.assignBlockVars("row", { NAME: "Lem" });

    expect(tpl.render("body")).toBe("H:Lem in Chat:F");
  });

  it("escapes markup in block variables as before", () => {
    const tpl = new Template();
    tpl.loadString("body", "<!-- BEGIN row -->{row.MESSAGE}<!-- END row -->");
    tpl.assignBlockVars("row", { MESSAGE: "<script>alert(1)</script>" });

    const out = tpl.render("body");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("a MarkupString root variable still emits raw HTML when the template asks for it", () => {
    const tpl = new Template();
    tpl.loadString("body", "{PAGINATION}");
    tpl.assignVars({ PAGINATION: markup('<a href="/p/2">2</a>') });

    expect(tpl.render("body")).toBe('<a href="/p/2">2</a>');
  });
});
