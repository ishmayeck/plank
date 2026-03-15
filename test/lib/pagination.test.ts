import { describe, it, expect } from "vitest";
import { generatePagination, topicGotoPage } from "../../src/lib/pagination.js";

describe("Pagination", () => {
  it("returns empty html for single page", () => {
    const result = generatePagination("/test", 10, 25, 1);
    expect(result.html).toBe("");
    expect(result.pageNumber).toBe("Page 1 of 1");
  });

  it("generates page links for multi-page content", () => {
    const result = generatePagination("/test", 100, 25, 1);
    expect(result.html).toContain("1");
    expect(result.html).toContain("4");
    expect(result.pageNumber).toBe("Page 1 of 4");
  });

  it("highlights current page", () => {
    const result = generatePagination("/test", 100, 25, 2);
    expect(result.html).toContain("<b>2</b>");
    expect(result.pageNumber).toBe("Page 2 of 4");
  });

  it("shows next link when not on last page", () => {
    const result = generatePagination("/test", 100, 25, 1);
    expect(result.html).toContain("Next");
  });

  it("shows previous link when not on first page", () => {
    const result = generatePagination("/test", 100, 25, 2);
    expect(result.html).toContain("Previous");
  });

  it("omits next link on last page", () => {
    const result = generatePagination("/test", 100, 25, 4);
    expect(result.html).not.toContain("Next");
  });
});

describe("topicGotoPage", () => {
  it("returns empty for single-page topics", () => {
    expect(topicGotoPage("/viewtopic/1", 5, 15)).toBe("");
  });

  it("generates page links for multi-page topics", () => {
    const result = topicGotoPage("/viewtopic/1", 30, 15);
    expect(result).toContain("1");
    expect(result).toContain("3");
  });
});
