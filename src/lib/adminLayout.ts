/**
 * Plank's admin chrome.
 *
 * Replaces the phpBB2 admin frameset (`index_frameset.tpl` +
 * `index_navigate.tpl`) with a single-page layout: a fixed sidebar
 * on the left, a scrolling main area on the right. We still render
 * the per-module body templates from `themes/<theme>/admin/` —
 * forms, tables, the matrix UIs — so the visual idiom matches the
 * user-facing forum. Only the chrome is Plank-owned.
 *
 * Why not a .tpl: the chrome is a thin shell with a static link list
 * and no block iteration. A TypeScript function keeps the navigation
 * tree type-checked and lets us flag the active entry without
 * fighting the engine.
 */

import { escapeHtml } from "./escape.js";

interface NavItem {
  label: string;
  url: string;
  /** Other URLs that should also light up this item (e.g. /admin/auth/forum/* belongs to /admin/auth). */
  prefix?: string;
}

interface NavSection {
  heading: string;
  items: NavItem[];
}

// Sidebar layout. Reorganized from phpBB2's six clusters into four
// task-oriented groups; the only inventions are the headings — every
// destination is an existing route.
const SIDEBAR: NavSection[] = [
  {
    heading: "Overview",
    items: [
      { label: "Dashboard", url: "/admin" },
    ],
  },
  {
    heading: "Forums",
    items: [
      { label: "Manage forums", url: "/admin/forums" },
      { label: "Permissions", url: "/admin/auth", prefix: "/admin/auth" },
    ],
  },
  {
    heading: "Users",
    items: [
      { label: "Manage users", url: "/admin/users" },
      { label: "Bans", url: "/admin/bans" },
    ],
  },
  {
    heading: "Customization",
    items: [
      { label: "Board configuration", url: "/admin/config" },
      { label: "Ranks", url: "/admin/ranks" },
      { label: "Smilies", url: "/admin/smilies" },
      { label: "Word censors", url: "/admin/words" },
    ],
  },
];

function isActive(item: NavItem, currentUrl: string): boolean {
  if (item.prefix) return currentUrl.startsWith(item.prefix);
  return currentUrl === item.url;
}

function renderSidebar(currentUrl: string): string {
  const sections = SIDEBAR.map((section) => {
    const items = section.items
      .map((item) => {
        const active = isActive(item, currentUrl);
        const cls = active ? "plank-admin-nav-item plank-admin-nav-item-active" : "plank-admin-nav-item";
        return `<li class="${cls}"><a href="${item.url}">${escapeHtml(item.label)}</a></li>`;
      })
      .join("");
    return `<div class="plank-admin-nav-section"><h3>${escapeHtml(section.heading)}</h3><ul>${items}</ul></div>`;
  }).join("");

  return (
    `<aside class="plank-admin-sidebar">` +
      `<div class="plank-admin-brand"><a href="/admin">Plank Admin</a></div>` +
      `<nav>${sections}</nav>` +
      `<div class="plank-admin-sidebar-footer">` +
        `<a href="/">&larr; Return to forum</a>` +
      `</div>` +
    `</aside>`
  );
}

const STYLES = `
  body { margin: 0; font-family: Verdana, Arial, Helvetica, sans-serif; font-size: 11px; color: #000; background: #E5E5E5; }
  .plank-admin-shell { display: flex; min-height: 100vh; }
  .plank-admin-sidebar {
    width: 200px; flex-shrink: 0; background: #FFF; border-right: 1px solid #98AAB1;
    padding: 16px 12px; box-sizing: border-box; position: sticky; top: 0; height: 100vh; overflow-y: auto;
  }
  .plank-admin-brand { font-size: 14px; font-weight: bold; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #DDD; }
  .plank-admin-brand a { color: #006699; text-decoration: none; }
  .plank-admin-nav-section { margin-bottom: 18px; }
  .plank-admin-nav-section h3 {
    margin: 0 0 6px 0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
    color: #666; font-weight: bold;
  }
  .plank-admin-nav-section ul { list-style: none; margin: 0; padding: 0; }
  .plank-admin-nav-item { margin: 0; }
  .plank-admin-nav-item a {
    display: block; padding: 4px 8px; color: #006699; text-decoration: none; border-radius: 2px;
  }
  .plank-admin-nav-item a:hover { background: #F0F0F0; }
  .plank-admin-nav-item-active a { background: #E5E5E5; color: #000; font-weight: bold; }
  .plank-admin-sidebar-footer {
    margin-top: 24px; padding-top: 12px; border-top: 1px solid #DDD; font-size: 10px;
  }
  .plank-admin-sidebar-footer a { color: #666; text-decoration: none; }
  .plank-admin-sidebar-footer a:hover { color: #006699; }
  .plank-admin-main { flex: 1; padding: 16px 24px; min-width: 0; }
  .plank-admin-footer {
    margin-top: 24px; padding: 12px 0; border-top: 1px solid #DDD; font-size: 10px; color: #888; text-align: center;
  }
`;

export interface AdminLayoutOpts {
  /** Goes into the document <title>. */
  title: string;
  /** Already-rendered HTML for the main panel. */
  body: string;
  /** Current request path, used to highlight the matching sidebar entry. */
  currentUrl: string;
}

export function renderAdminPage(opts: AdminLayoutOpts): string {
  const sidebar = renderSidebar(opts.currentUrl);
  // Absolute href so the link resolves regardless of the route depth
  // (the original page_header.tpl used `..` which broke for any URL
  // deeper than /admin/foo — e.g. /admin/auth/forum/12).
  const themeCss = `<link rel="stylesheet" href="/templates/Solaris/admin/subSilver.css" type="text/css" />`;
  return (
    `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">` +
    `<html><head>` +
      `<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />` +
      `<title>${escapeHtml(opts.title)}</title>` +
      themeCss +
      `<style>${STYLES}</style>` +
    `</head><body>` +
      `<div class="plank-admin-shell">` +
        sidebar +
        `<main class="plank-admin-main">${opts.body}` +
          `<div class="plank-admin-footer">Plank Forum &middot; Administration Panel</div>` +
        `</main>` +
      `</div>` +
    `</body></html>`
  );
}
