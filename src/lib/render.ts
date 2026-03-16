import { join } from "node:path";
import { Template } from "../template/engine.js";

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
    ADMIN_LINK: ctx.user?.userLevel && ctx.user.userLevel >= 1
      ? '<a href="/admin">Go to Administration Panel</a><br /><br />'
      : "",
    TRANSLATION_INFO: "",
  });

  // Replace phpBB "Powered by" with Plank credit
  tpl.registerSubstitution(
    /^.*target="_phpbb".*$/m,
    '<span class="copyright">Powered by Plank</span>'
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
    ? `<base href="/"><meta http-equiv="refresh" content="5;url=${opts.redirectUrl}">`
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
