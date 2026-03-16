import { describe, it, expect } from "vitest";
import { parseBBCode } from "../../src/lib/bbcode.js";

describe("BBCode Parser", () => {
  describe("text formatting", () => {
    it("parses bold", () => {
      expect(parseBBCode("[b]bold[/b]")).toBe("<strong>bold</strong>");
    });

    it("parses italic", () => {
      expect(parseBBCode("[i]italic[/i]")).toBe("<em>italic</em>");
    });

    it("parses underline", () => {
      expect(parseBBCode("[u]underline[/u]")).toBe(
        "<span style=\"text-decoration: underline;\">underline</span>"
      );
    });

    it("parses nested formatting", () => {
      expect(parseBBCode("[b][i]bold italic[/i][/b]")).toBe(
        "<strong><em>bold italic</em></strong>"
      );
    });
  });

  describe("color and size", () => {
    it("parses color", () => {
      expect(parseBBCode("[color=red]red text[/color]")).toBe(
        '<span style="color: red;">red text</span>'
      );
    });

    it("parses size", () => {
      expect(parseBBCode("[size=18]big text[/size]")).toBe(
        '<span style="font-size: 18px;">big text</span>'
      );
    });
  });

  describe("links", () => {
    it("parses url with text", () => {
      expect(parseBBCode("[url=https://example.com]Example[/url]")).toBe(
        '<a href="https://example.com" rel="nofollow">Example</a>'
      );
    });

    it("parses url without text", () => {
      expect(parseBBCode("[url]https://example.com[/url]")).toBe(
        '<a href="https://example.com" rel="nofollow">https://example.com</a>'
      );
    });

    it("rejects javascript: urls", () => {
      const result = parseBBCode("[url=javascript:alert(1)]click[/url]");
      expect(result).not.toContain("javascript:");
    });
  });

  describe("images", () => {
    it("parses img tag", () => {
      expect(parseBBCode("[img]https://example.com/pic.jpg[/img]")).toBe(
        '<img src="https://example.com/pic.jpg" alt="" />'
      );
    });
  });

  describe("code blocks", () => {
    it("parses code", () => {
      const result = parseBBCode("[code]var x = 1;[/code]");
      expect(result).toContain('class="code"');
      expect(result).toContain("var x = 1;");
      expect(result).toContain("<b>Code:</b>");
    });

    it("does not parse bbcode inside code blocks", () => {
      const result = parseBBCode("[code][b]not bold[/b][/code]");
      expect(result).toContain("[b]not bold[/b]");
      expect(result).toContain('class="code"');
    });
  });

  describe("quotes", () => {
    it("parses simple quote", () => {
      expect(parseBBCode("[quote]quoted text[/quote]")).toContain(
        "quoted text"
      );
      expect(parseBBCode("[quote]quoted text[/quote]")).toContain('class="quote"');
    });

    it("parses quote with attribution", () => {
      const result = parseBBCode('[quote="Lem"]quoted text[/quote]');
      expect(result).toContain("Lem");
      expect(result).toContain("quoted text");
    });
  });

  describe("lists", () => {
    it("parses unordered list", () => {
      const result = parseBBCode("[list][*]item 1[*]item 2[/list]");
      expect(result).toContain("<ul>");
      expect(result).toContain("<li>item 1</li>");
      expect(result).toContain("<li>item 2</li>");
    });

    it("parses ordered list", () => {
      const result = parseBBCode("[list=1][*]first[*]second[/list]");
      expect(result).toContain("<ol");
      expect(result).toContain("<li>first</li>");
    });

    it("parses alpha ordered list", () => {
      const result = parseBBCode("[list=a][*]alpha[*]bravo[/list]");
      expect(result).toContain('type="a"');
    });
  });

  describe("newlines", () => {
    it("converts newlines to br tags", () => {
      expect(parseBBCode("line 1\nline 2")).toBe("line 1<br />\nline 2");
    });

    it("does not convert newlines inside code blocks", () => {
      const result = parseBBCode("[code]line 1\nline 2[/code]");
      expect(result).not.toContain("<br />");
    });
  });

  describe("plain text", () => {
    it("passes through plain text", () => {
      expect(parseBBCode("Hello, World!")).toBe("Hello, World!");
    });

    it("escapes HTML in plain text", () => {
      expect(parseBBCode("<script>alert('xss')</script>")).toBe(
        "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;"
      );
    });
  });

  describe("auto-linking", () => {
    it("auto-links bare URLs", () => {
      const result = parseBBCode("Visit https://example.com today");
      expect(result).toContain('<a href="https://example.com"');
      expect(result).toContain("https://example.com</a>");
    });
  });
});
