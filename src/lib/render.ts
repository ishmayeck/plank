import { join } from "node:path";
import { Template } from "../template/engine.js";

const THEME = "Solaris";
const THEMES_DIR = join(import.meta.dirname, "..", "..", "themes");
const THEME_DIR = join(THEMES_DIR, THEME);

export interface RenderContext {
  user?: {
    id: string;
    username: string;
    unreadPms: number;
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
    L_LOGIN_LOGOUT: isLoggedIn ? "Logout" : "Login",
    L_FAQ: "FAQ",
    L_SEARCH: "Search",
    L_MEMBERLIST: "Memberlist",
    L_PROFILE: "Profile",
    L_USERGROUPS: "Usergroups",
    L_REGISTER: "Register",

    // PM info
    PRIVATE_MESSAGE_INFO: isLoggedIn
      ? `${ctx.user!.unreadPms} new message${ctx.user!.unreadPms !== 1 ? "s" : ""}`
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
    ADMIN_LINK: "",
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
