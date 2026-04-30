import { describe, it, expect } from "vitest";
import { escapeHtml, escapeRegex } from "../../src/lib/escape.js";

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });

  it("escapes double and single quotes", () => {
    expect(escapeHtml(`it's "quoted"`)).toBe("it&#39;s &quot;quoted&quot;");
  });

  it("escapes ampersand first to avoid double-escaping", () => {
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });

  it("returns empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("leaves safe characters alone", () => {
    expect(escapeHtml("Hello, world! 123")).toBe("Hello, world! 123");
  });
});

describe("escapeRegex", () => {
  it("escapes regex metacharacters", () => {
    expect(escapeRegex(".*+?^${}()|[]\\")).toBe(
      "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\"
    );
  });

  it("leaves plain text unchanged", () => {
    expect(escapeRegex("hello world")).toBe("hello world");
  });

  it("escapes a smiley code so it can be used as a literal", () => {
    const escaped = escapeRegex(":)");
    const re = new RegExp(escaped, "g");
    expect("hi :) bye :)".replace(re, "X")).toBe("hi X bye X");
  });
});
