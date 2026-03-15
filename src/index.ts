import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { join } from "node:path";
import { Template } from "./template/engine.js";

const app = new Hono();

const THEME = "Solaris";
const THEMES_DIR = join(import.meta.dirname, "..", "themes");
const THEME_DIR = join(THEMES_DIR, THEME);

// Serve theme static assets (CSS, images)
app.use(
  "/templates/Solaris/*",
  serveStatic({ root: "./themes/", rewriteRequestPath: (path) => path.replace("/templates/", "/") })
);

// Test route: render Solaris header + footer with dummy data
app.get("/", (c) => {
  const tpl = new Template(THEME_DIR);
  tpl.loadFile("header", "overall_header.tpl");
  tpl.loadFile("body", "index_body.tpl");
  tpl.loadFile("footer", "overall_footer.tpl");

  tpl.assignVars({
    S_CONTENT_DIRECTION: "ltr",
    S_CONTENT_ENCODING: "utf-8",
    SITENAME: "Plank Forum",
    PAGE_TITLE: "Index",
    T_HEAD_STYLESHEET: "Solaris.css",
    META: "",
    NAV_LINKS: "",
    U_INDEX: "/",
    U_FAQ: "/faq",
    U_SEARCH: "/search",
    U_MEMBERLIST: "/memberlist",
    U_PROFILE: "/profile",
    U_PRIVATEMSGS: "/privmsg",
    U_LOGIN_LOGOUT: "/login",
    U_REGISTER: "/register",
    U_GROUP_CP: "/groupcp",
    PRIVATE_MESSAGE_INFO: "0 new messages",
    PRIVATE_MESSAGE_NEW_FLAG: "0",
    PRIVMSG_IMG: "templates/Solaris/images/lang_english/topimg_pms-d.jpg",
    L_FAQ: "FAQ",
    L_SEARCH: "Search",
    L_MEMBERLIST: "Memberlist",
    L_PROFILE: "Profile",
    L_USERGROUPS: "Usergroups",
    L_LOGIN_LOGOUT: "Login",
    L_REGISTER: "Register",
    U_PRIVATEMSGS_POPUP: "/privmsg?mode=popup",
    PHPBB_VERSION: "",
    ADMIN_LINK: "",
    TRANSLATION_INFO: "",

    // index_body vars
    L_INDEX: "Index",
    L_FORUM: "Forum",
    L_TOPICS: "Topics",
    L_POSTS: "Posts",
    L_LASTPOST: "Last Post",
    L_WHO_IS_ONLINE: "Who Is Online",
    TOTAL_POSTS: "42 posts total",
    TOTAL_USERS: "5 registered users",
    NEWEST_USER: "Harey",
    TOTAL_USERS_ONLINE: "1 user online",
    L_WHOSONLINE_ADMIN: "Admin",
    L_WHOSONLINE_MOD: "Mod",
    RECORD_USERS: "5",
    LOGGED_IN_USER_LIST: "",
    L_ONLINE_EXPLAIN: "",
    CURRENT_TIME: new Date().toLocaleString(),
    U_VIEWONLINE: "/viewonline",
    L_NEW_POSTS: "New posts",
    L_NO_NEW_POSTS: "No new posts",
    L_FORUM_LOCKED: "Forum locked",
    S_TIMEZONE: "UTC",
    U_MARK_READ: "/markread",
    L_MARK_FORUMS_READ: "Mark all forums read",
    S_LOGIN_ACTION: "/login",
    L_USERNAME: "Username",
    L_PASSWORD: "Password",
    L_AUTO_LOGIN: "Log me on automatically",
    L_LOGIN: "Login",
    U_SEARCH_NEW: "/search?mode=new",
    U_SEARCH_SELF: "/search?mode=self",
    L_SEARCH_NEW: "View posts since last visit",
    L_SEARCH_SELF: "View your posts",
    U_SEARCH_UNANSWERED: "/search?mode=unanswered",
    L_SEARCH_UNANSWERED: "View unanswered posts",
    LAST_VISIT_DATE: "",
  });

  // Add a sample category and forum
  tpl.assignBlockVars("catrow", {
    U_VIEWCAT: "/category/1",
    CAT_DESC: "General",
  });
  tpl.assignBlockVars("catrow.forumrow", {
    FORUM_FOLDER_IMG: "templates/Solaris/images/folder.gif",
    U_VIEWFORUM: "/viewforum/1",
    FORUM_NAME: "General Discussion",
    FORUM_DESC: "Talk about anything",
    L_MODERATOR: "Moderator:",
    MODERATORS: "Admin",
    TOPICS: "3",
    POSTS: "42",
    LAST_POST: "Today by Admin",
  });

  // Show logged-out state
  tpl.assignBlockVars("switch_user_logged_out", {});
  tpl.assignBlockVars("switch_allow_autologin", {});

  const html = tpl.render("header") + tpl.render("body") + tpl.render("footer");
  return c.html(html);
});

const port = 3000;
console.log(`Plank running at http://localhost:${port}`);
serve({ fetch: app.fetch, port });

export default app;
