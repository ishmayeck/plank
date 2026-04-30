import { markup, type MarkupString } from "./markup.js";

/**
 * Generate phpBB2-style pagination HTML.
 *
 * Example output: "1, 2, 3 ... 10, 11" with links
 */
export function generatePagination(
  baseUrl: string,
  totalItems: number,
  perPage: number,
  currentPage: number
): { html: MarkupString; pageNumber: string } {
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));

  if (totalPages <= 1) {
    return { html: markup(""), pageNumber: "Page 1 of 1" };
  }

  const pages: string[] = [];

  // Always show first page
  if (currentPage === 1) {
    pages.push('<span class="gensmall"><b>1</b></span>');
  } else {
    pages.push(
      `<span class="gensmall"><a href="${pageUrl(baseUrl, 1)}">1</a></span>`
    );
  }

  // Calculate range around current page
  let rangeStart = Math.max(2, currentPage - 2);
  let rangeEnd = Math.min(totalPages - 1, currentPage + 2);

  // Add ellipsis after first page if needed
  if (rangeStart > 2) {
    pages.push('<span class="gensmall">...</span>');
  }

  // Middle pages
  for (let i = rangeStart; i <= rangeEnd; i++) {
    if (i === currentPage) {
      pages.push(`<span class="gensmall"><b>${i}</b></span>`);
    } else {
      pages.push(
        `<span class="gensmall"><a href="${pageUrl(baseUrl, i)}">${i}</a></span>`
      );
    }
  }

  // Add ellipsis before last page if needed
  if (rangeEnd < totalPages - 1) {
    pages.push('<span class="gensmall">...</span>');
  }

  // Always show last page
  if (totalPages > 1) {
    if (currentPage === totalPages) {
      pages.push(`<span class="gensmall"><b>${totalPages}</b></span>`);
    } else {
      pages.push(
        `<span class="gensmall"><a href="${pageUrl(baseUrl, totalPages)}">${totalPages}</a></span>`
      );
    }
  }

  // Previous/Next links
  const prev =
    currentPage > 1
      ? `<span class="gensmall"><a href="${pageUrl(baseUrl, currentPage - 1)}">&laquo; Previous</a></span>&nbsp;&nbsp;`
      : "";
  const next =
    currentPage < totalPages
      ? `&nbsp;&nbsp;<span class="gensmall"><a href="${pageUrl(baseUrl, currentPage + 1)}">Next &raquo;</a></span>`
      : "";

  return {
    html: markup(prev + pages.join(", ") + next),
    pageNumber: `Page ${currentPage} of ${totalPages}`,
  };
}

function pageUrl(baseUrl: string, page: number): string {
  const sep = baseUrl.includes("?") ? "&" : "?";
  return page === 1 ? baseUrl : `${baseUrl}${sep}page=${page}`;
}

/**
 * Generate "go to page" links for a topic in the topic list.
 * E.g., "[ 1, 2, 3 ]" for multi-page topics.
 */
export function topicGotoPage(
  topicUrl: string,
  replyCount: number,
  postsPerPage: number
): MarkupString {
  const totalPages = Math.ceil((replyCount + 1) / postsPerPage);
  if (totalPages <= 1) return markup("");

  const links: string[] = [];
  const showPages = Math.min(totalPages, 4);

  for (let i = 1; i <= showPages; i++) {
    links.push(`<a href="${topicUrl}?page=${i}">${i}</a>`);
  }

  if (totalPages > 4) {
    links.push("...");
    links.push(
      `<a href="${topicUrl}?page=${totalPages}">${totalPages}</a>`
    );
  }

  return markup(`<span class="gensmall">[ ${links.join(", ")} ]</span>`);
}
