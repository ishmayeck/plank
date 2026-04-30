import { join } from "node:path";
import { Template } from "../template/engine.js";
import { USER_LEVEL, isAdmin } from "./userLevel.js";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Format a date in phpBB2 default style.
 * Full:      "Sun Mar 15, 2026 2:27 am"
 * Date-only: "15 Mar 2026"
 */
export function formatPhpBBDate(
  date: Date | string,
  dateOnly = false
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const day = d.getUTCDate().toString().padStart(2, "0");
  const mon = MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();

  if (dateOnly) return `${day} ${mon} ${year}`;

  const dayName = DAYS[d.getUTCDay()];
  let hours = d.getUTCHours();
  const ampm = hours >= 12 ? "pm" : "am";
  hours = hours % 12 || 12;
  const minutes = d.getUTCMinutes().toString().padStart(2, "0");
  return `${dayName} ${mon} ${day}, ${year} ${hours}:${minutes} ${ampm}`;
}

const THEME = "Solaris";
const THEMES_DIR = join(import.meta.dirname, "..", "..", "themes");
const THEME_DIR = join(THEMES_DIR, THEME);

export interface RenderContext {
  user?: {
    id: string;
    username: string;
    unreadPms: number;
    userLevel?: number;
  } | null;
  pageTitle?: string;
}

/**
 * Create a Template instance pre-loaded with header and footer,
 * and common variables already assigned.
 */
export function createPageTemplate(ctx: RenderContext): Template {
  const tpl = new Template(THEME_DIR);
  tpl.loadFile("header", "overall_header.tpl");
  tpl.loadFile("footer", "overall_footer.tpl");

  const isLoggedIn = !!ctx.user;

  tpl.assignVars({
    S_CONTENT_DIRECTION: "ltr",
    S_CONTENT_ENCODING: "utf-8",
    SITENAME: "Plank Forum",
    PAGE_TITLE: ctx.pageTitle ?? "Index",
    T_HEAD_STYLESHEET: "Solaris.css",
    META: '<base href="/">',
    NAV_LINKS: "",

    // Navigation URLs
    U_INDEX: "/",
    U_FAQ: "/faq",
    U_SEARCH: "/search",
    U_MEMBERLIST: "/memberlist",
    U_PROFILE: isLoggedIn ? "/profile" : "/login",
    U_PRIVATEMSGS: isLoggedIn ? "/privmsg" : "/login",
    U_LOGIN_LOGOUT: isLoggedIn ? "/logout" : "/login",
    U_REGISTER: "/register",
    U_GROUP_CP: "/groupcp",

    // Auth-dependent labels
    L_LOGIN_LOGOUT: isLoggedIn ? "Log out" : "Log in",
    L_FAQ: "FAQ",
    L_SEARCH: "Search",
    L_MEMBERLIST: "Memberlist",
    L_PROFILE: "Profile",
    L_USERGROUPS: "Usergroups",
    L_REGISTER: "Register",

    // PM info
    PRIVATE_MESSAGE_INFO: isLoggedIn
      ? ctx.user!.unreadPms > 0
        ? `You have <b>${ctx.user!.unreadPms}</b> new message${ctx.user!.unreadPms !== 1 ? "s" : ""}`
        : "You have no new messages"
      : "",
    PRIVATE_MESSAGE_NEW_FLAG: isLoggedIn && ctx.user!.unreadPms > 0 ? "1" : "0",
    PRIVMSG_IMG: isLoggedIn && ctx.user!.unreadPms > 0
      ? "templates/Solaris/images/lang_english/topimg_newpms.jpg"
      : "templates/Solaris/images/lang_english/topimg_pms-d.jpg",
    U_PRIVATEMSGS_POPUP: "/privmsg?mode=popup",

    // User info
    USERNAME: ctx.user?.username ?? "",

    // Footer
    PHPBB_VERSION: "",
    ADMIN_LINK: isAdmin(ctx.user)
      ? '<a href="/admin">Go to Administration Panel</a><br /><br />'
      : "",
    TRANSLATION_INFO: "",
  });

  // Replace phpBB "Powered by" with Plank credit
  tpl.registerSubstitution(
    /^.*target="_phpbb".*$/m,
    'Powered by Plank</span></div>'
  );

  // Auth state switches
  if (isLoggedIn) {
    tpl.assignBlockVars("switch_user_logged_in", {});
  } else {
    tpl.assignBlockVars("switch_user_logged_out", {});
  }

  return tpl;
}

/**
 * Render a complete page with header + body + footer.
 */
export function renderPage(
  tpl: Template,
  bodyHandle: string = "body"
): string {
  return tpl.render("header") + tpl.render(bodyHandle) + tpl.render("footer");
}

/**
 * Render a forum jumpbox (dropdown selector) using jumpbox.tpl.
 * Returns HTML string for the {JUMPBOX} template variable.
 */
export function renderJumpbox(
  forums: { id: number; forum_name: string; cat_id?: number }[],
  categories?: { id: number; cat_title: string }[],
  selectedForumId?: number
): string {
  const tpl = new Template(THEME_DIR);
  tpl.loadFile("jumpbox", "jumpbox.tpl");

  let options = '<option value="-1">Select a forum</option>';
  if (categories && categories.length > 0) {
    const forumsByCat = new Map<number, typeof forums>();
    for (const f of forums) {
      const catId = f.cat_id ?? 0;
      if (!forumsByCat.has(catId)) forumsByCat.set(catId, []);
      forumsByCat.get(catId)!.push(f);
    }
    for (const cat of categories) {
      const catForums = forumsByCat.get(cat.id) ?? [];
      if (catForums.length === 0) continue;
      options += `<option value="-1">&nbsp;</option>`;
      options += `<option value="-1">${cat.cat_title}</option>`;
      options += `<option value="-1">----------------</option>`;
      for (const f of catForums) {
        const sel = f.id === selectedForumId ? " selected" : "";
        options += `<option value="${f.id}"${sel}>&nbsp;&nbsp;${f.forum_name}</option>`;
      }
    }
  } else {
    for (const f of forums) {
      const sel = f.id === selectedForumId ? " selected" : "";
      options += `<option value="${f.id}"${sel}>${f.forum_name}</option>`;
    }
  }

  tpl.assignVars({
    S_JUMPBOX_ACTION: "#",
    L_JUMP_TO: "Jump to",
    S_JUMPBOX_SELECT: `<select name="f" onchange="if(this.options[this.selectedIndex].value != -1){ window.location='/viewforum/'+this.options[this.selectedIndex].value; }">${options}</select>`,
    L_GO: "Go",
  });

  return tpl.render("jumpbox");
}

/**
 * Fetch forum/category lists and render the jumpbox in one call.
 * Accepts any Supabase client and an optional selected forum ID.
 */
export async function fetchAndRenderJumpbox(
  supabase: { from: (table: string) => any },
  selectedForumId?: number
): Promise<string> {
  const [{ data: forums }, { data: cats }] = await Promise.all([
    supabase.from("forums").select("id, forum_name, cat_id").order("forum_order"),
    supabase.from("categories").select("id, cat_title").order("cat_order"),
  ]);
  return renderJumpbox(forums ?? [], cats ?? [], selectedForumId);
}

// ─── Role color constants (Solaris theme) ────────────────────
// fontcolor3 = Admin (orange), fontcolor2 = Moderator (white)
export const ADMIN_COLOR = "#FD4000";
export const MOD_COLOR = "#FFFFFF";

/**
 * Format a username link with phpBB2-style role coloring.
 * Admin: bold + orange (#FD4000), Moderator: bold + white (#FFFFFF).
 */
export function formatUsernameLink(
  id: string,
  username: string,
  userLevel: number
): string {
  if (userLevel === USER_LEVEL.ADMIN) {
    return `<a href="/profile/${id}" style="color:${ADMIN_COLOR}"><b>${username}</b></a>`;
  }
  if (userLevel === USER_LEVEL.MOD) {
    return `<a href="/profile/${id}" style="color:${MOD_COLOR}"><b>${username}</b></a>`;
  }
  return `<a href="/profile/${id}">${username}</a>`;
}

/**
 * Render an error box using error_body.tpl, matching phpBB2's error display.
 * Returns an HTML string suitable for the {ERROR_BOX} template variable.
 */
export function renderErrorBox(message: string): string {
  const tpl = new Template(THEME_DIR);
  tpl.loadFile("error", "error_body.tpl");
  tpl.assignVars({ ERROR_MESSAGE: message });
  return tpl.render("error");
}

/**
 * Render an interstitial message page using message_body.tpl.
 * Matches phpBB2's message_die(GENERAL_MESSAGE, ...) pattern.
 *
 * messageHtml can include links (e.g. "Click <a href="/">here</a> to return").
 * If redirectUrl is provided, a 5-second meta refresh is added.
 */
export function renderMessagePage(opts: {
  ctx: RenderContext;
  title: string;
  messageHtml: string;
  redirectUrl?: string;
}): string {
  const meta = opts.redirectUrl
    ? `<base href="/"><meta http-equiv="refresh" content="3;url=${opts.redirectUrl}">`
    : '<base href="/">';

  const tpl = createPageTemplate(opts.ctx);
  tpl.assignVars({ META: meta });
  tpl.loadFile("body", "message_body.tpl");
  tpl.assignVars({
    MESSAGE_TITLE: opts.title,
    MESSAGE_TEXT: opts.messageHtml,
    U_INDEX: "/",
    L_INDEX: "Index",
  });
  return renderPage(tpl);
}
