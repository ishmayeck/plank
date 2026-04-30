import { describe, it, expect } from "vitest";
import { generatePagination, topicGotoPage } from "../../src/lib/pagination.js";

describe("Pagination", () => {
  it("returns empty html for single page", () => {
    const result = generatePagination("/test", 10, 25, 1);
    expect(result.html.html).toBe("");
    expect(result.pageNumber).toBe("Page 1 of 1");
  });

  it("generates page links for multi-page content", () => {
    const result = generatePagination("/test", 100, 25, 1);
    expect(result.html.html).toContain("1");
    expect(result.html.html).toContain("4");
    expect(result.pageNumber).toBe("Page 1 of 4");
  });

  it("highlights current page", () => {
    const result = generatePagination("/test", 100, 25, 2);
    expect(result.html.html).toContain("<b>2</b>");
    expect(result.pageNumber).toBe("Page 2 of 4");
  });

  it("shows next link when not on last page", () => {
    const result = generatePagination("/test", 100, 25, 1);
    expect(result.html.html).toContain("Next");
  });

  it("shows previous link when not on first page", () => {
    const result = generatePagination("/test", 100, 25, 2);
    expect(result.html.html).toContain("Previous");
  });

  it("omits next link on last page", () => {
    const result = generatePagination("/test", 100, 25, 4);
    expect(result.html.html).not.toContain("Next");
  });

  it("preserves query string params and replaces existing page=", () => {
    const result = generatePagination("/search?q=x&page=2", 100, 25, 3);
    expect(result.html.html).toContain("/search?q=x&page=4");
    expect(result.html.html).toContain("/search?q=x&page=2");
    // Should not produce duplicate ?page= or &page=2&page=3
    expect(result.html.html).not.toMatch(/page=\d+&page=/);
  });

  it("drops the page= param when linking to page 1 on a URL with query", () => {
    const result = generatePagination("/search?q=x", 100, 25, 4);
    // Page 1 link should be /search?q=x with no page param
    expect(result.html.html).toContain('href="/search?q=x"');
  });
});

describe("topicGotoPage", () => {
  it("returns empty for single-page topics", () => {
    expect(topicGotoPage("/viewtopic/1", 5, 15).html).toBe("");
  });

  it("generates page links for multi-page topics", () => {
    const result = topicGotoPage("/viewtopic/1", 30, 15).html;
    expect(result).toContain("1");
    expect(result).toContain("3");
  });
});
