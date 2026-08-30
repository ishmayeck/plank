import { Hono } from "hono";
import type { Context } from "hono";
import type { Template } from "../template/engine.js";
import { createTemplate } from "../template/source.js";
import { getSupabaseAdmin } from "../db/client.js";
import { escapeHtml } from "../lib/escape.js";
import { markup } from "../lib/markup.js";
import { formHiddenFields, validateQueryCsrf, csrfQueryParam } from "../lib/csrf.js";
import { USER_LEVEL, isAdmin } from "../lib/userLevel.js";
import { clearSmiliesCache } from "../lib/smilies.js";
import { clearCensorCache } from "../lib/wordcensor.js";
import { renderAdminPage } from "../lib/adminLayout.js";

const admin = new Hono();

/**
 * Build a Template for an admin page body. Only the per-module body
 * template from `themes/<theme>/admin/` is loaded — chrome (header,
 * sidebar, footer) is rendered separately via renderAdminPage so the
 * layout can diverge from phpBB2's frameset without touching theme
 * files.
 */
function adminRender(bodyTpl: string): Template {
  const tpl = createTemplate();
  tpl.loadFile("body", `admin/${bodyTpl}`);
  return tpl;
}

/**
 * Render the body slot, wrap it in Plank's admin shell, return the
 * final HTML. `title` defaults to a generic label; pass a more
 * specific one (e.g. "Forum Administration") if you have it.
 */
function renderAdmin(c: Context, tpl: Template, title: string = "Administration Panel"): string {
  return renderAdminPage({
    title: `Plank Forum :: ${title}`,
    body: tpl.render("body"),
    currentUrl: new URL(c.req.url).pathname,
  });
}

// ─── Admin Index / Dashboard ──────────────────────────────────

admin.get("/admin", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const adminDb = getSupabaseAdmin();

  // Gather stats
  const { count: postCount } = await adminDb
    .from("posts")
    .select("*", { count: "exact", head: true });

  const { count: topicCount } = await adminDb
    .from("topics")
    .select("*", { count: "exact", head: true });

  const { count: userCount } = await adminDb
    .from("profiles")
    .select("*", { count: "exact", head: true });

  const tpl = adminRender("index_body.tpl");

  tpl.assignVars({
    L_WELCOME: "Welcome to the Admin Panel",
    L_ADMIN_INTRO: "From here you can control all aspects of your forum.",
    L_FORUM_STATS: "Forum Statistics",
    L_STATISTIC: "Statistic",
    L_VALUE: "Value",
    L_NUMBER_POSTS: "Number of posts",
    L_POSTS_PER_DAY: "Posts per day",
    L_NUMBER_TOPICS: "Number of topics",
    L_TOPICS_PER_DAY: "Topics per day",
    L_NUMBER_USERS: "Number of users",
    L_USERS_PER_DAY: "Users per day",
    L_BOARD_STARTED: "Board started",
    L_AVATAR_DIR_SIZE: "Avatar directory size",
    L_DB_SIZE: "Database size",
    L_GZIP_COMPRESSION: "Gzip compression",
    NUMBER_OF_POSTS: String(postCount ?? 0),
    NUMBER_OF_TOPICS: String(topicCount ?? 0),
    NUMBER_OF_USERS: String(userCount ?? 0),
    POSTS_PER_DAY: "N/A",
    TOPICS_PER_DAY: "N/A",
    USERS_PER_DAY: "N/A",
    START_DATE: "N/A",
    AVATAR_DIR_SIZE: "N/A",
    DB_SIZE: "N/A",
    GZIP_COMPRESSION: "Off",
    L_WHO_IS_ONLINE: "Who is Online",
    L_USERNAME: "Username",
    L_STARTED: "Started",
    L_LAST_UPDATE: "Last Updated",
    L_FORUM_LOCATION: "Location",
    L_IP_ADDRESS: "IP Address",
    L_VERSION_INFORMATION: "Version Information",
    VERSION_INFO: "<p>Plank Forum 1.0 (phpBB2 reimplementation)</p>",
  });

  return c.html(renderAdmin(c, tpl));
});

// ─── Board Configuration ──────────────────────────────────────

admin.get("/admin/config", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const adminDb = getSupabaseAdmin();
  const { data: configs } = await adminDb.from("config").select("*");

  const cfg: Record<string, string> = {};
  if (configs) {
    for (const row of configs) {
      cfg[row.config_name] = row.config_value;
    }
  }

  const tpl = adminRender("board_config_body.tpl");

  tpl.assignVars({
    L_CONFIGURATION_TITLE: "Board Configuration",
    L_CONFIGURATION_EXPLAIN: "Here you can customize all board settings.",
    L_GENERAL_SETTINGS: "General Settings",
    S_CONFIG_ACTION: "/admin/config",
    L_SUBMIT: "Submit",
    L_RESET: "Reset",
    S_HIDDEN_FIELDS: formHiddenFields(c),

    // General
    L_SERVER_NAME: "Server name",
    L_SERVER_PORT: "Server port",
    L_SERVER_PORT_EXPLAIN: "Usually 80",
    L_SCRIPT_PATH: "Script path",
    L_SCRIPT_PATH_EXPLAIN: "The path where Plank is installed",
    L_SITE_NAME: "Site name",
    L_SITE_NAME_EXPLAIN: "The name of your forum",
    L_SITE_DESCRIPTION: "Site description",
    L_DISABLE_BOARD: "Disable board",
    L_DISABLE_BOARD_EXPLAIN: "Make the board unavailable to users",
    L_ACCT_ACTIVATION: "Account activation",
    L_VISUAL_CONFIRM: "Visual confirmation",
    L_VISUAL_CONFIRM_EXPLAIN: "Enable CAPTCHA on registration",
    L_ALLOW_AUTOLOGIN: "Allow auto-login",
    L_ALLOW_AUTOLOGIN_EXPLAIN: "Allow persistent login cookies",
    L_AUTOLOGIN_TIME: "Auto-login key expiry",
    L_AUTOLOGIN_TIME_EXPLAIN: "Days before auto-login key expires",
    L_BOARD_EMAIL_FORM: "Email via board",
    L_BOARD_EMAIL_FORM_EXPLAIN: "Send email via board contact form",
    L_FLOOD_INTERVAL: "Flood interval",
    L_FLOOD_INTERVAL_EXPLAIN: "Seconds between posts",
    L_SEARCH_FLOOD_INTERVAL: "Search flood interval",
    L_SEARCH_FLOOD_INTERVAL_EXPLAIN: "Seconds between searches",
    L_MAX_LOGIN_ATTEMPTS: "Max login attempts",
    L_MAX_LOGIN_ATTEMPTS_EXPLAIN: "Before login lockout",
    L_LOGIN_RESET_TIME: "Login reset time",
    L_LOGIN_RESET_TIME_EXPLAIN: "Minutes before login counter resets",
    L_TOPICS_PER_PAGE: "Topics per page",
    L_POSTS_PER_PAGE: "Posts per page",
    L_HOT_THRESHOLD: "Hot topic threshold",
    L_DEFAULT_STYLE: "Default style",
    L_OVERRIDE_STYLE: "Override user style",
    L_OVERRIDE_STYLE_EXPLAIN: "Force default style for all users",
    L_DEFAULT_LANGUAGE: "Default language",
    L_DATE_FORMAT: "Date format",
    L_DATE_FORMAT_EXPLAIN: "Syntax is PHP date() format",
    L_SYSTEM_TIMEZONE: "System timezone",
    L_ENABLE_GZIP: "Enable GZip",
    L_ENABLE_PRUNE: "Enable pruning",
    L_YES: "Yes",
    L_NO: "No",
    L_NONE: "None",
    L_USER: "User",
    L_ADMIN: "Admin",
    L_ENABLED: "Enabled",
    L_DISABLED: "Disabled",

    // Cookie
    L_COOKIE_SETTINGS: "Cookie Settings",
    L_COOKIE_SETTINGS_EXPLAIN: "Configure cookie parameters.",
    L_COOKIE_DOMAIN: "Cookie domain",
    L_COOKIE_NAME: "Cookie name",
    L_COOKIE_PATH: "Cookie path",
    L_COOKIE_SECURE: "Cookie secure",
    L_COOKIE_SECURE_EXPLAIN: "Require HTTPS for cookies",
    L_SESSION_LENGTH: "Session length",

    // PM
    L_PRIVATE_MESSAGING: "Private Messaging",
    L_DISABLE_PRIVATE_MESSAGING: "Private messaging",
    L_INBOX_LIMIT: "Inbox limit",
    L_SENTBOX_LIMIT: "Sentbox limit",
    L_SAVEBOX_LIMIT: "Savebox limit",

    // Abilities
    L_ABILITIES_SETTINGS: "Posting Abilities",
    L_MAX_POLL_OPTIONS: "Max poll options",
    L_ALLOW_HTML: "Allow HTML",
    L_ALLOWED_TAGS: "Allowed HTML tags",
    L_ALLOWED_TAGS_EXPLAIN: "Comma-separated list",
    L_ALLOW_BBCODE: "Allow BBCode",
    L_ALLOW_SMILIES: "Allow smilies",
    L_SMILIES_PATH: "Smilies path",
    L_SMILIES_PATH_EXPLAIN: "Path to smiley images",
    L_ALLOW_SIG: "Allow signatures",
    L_MAX_SIG_LENGTH: "Max signature length",
    L_MAX_SIG_LENGTH_EXPLAIN: "Max characters in signatures",
    L_ALLOW_NAME_CHANGE: "Allow username change",

    // Avatars
    L_AVATAR_SETTINGS: "Avatar Settings",
    L_ALLOW_LOCAL: "Allow local avatars",
    L_ALLOW_REMOTE: "Allow remote avatars",
    L_ALLOW_REMOTE_EXPLAIN: "Link to avatar on another site",
    L_ALLOW_UPLOAD: "Allow avatar upload",
    L_MAX_FILESIZE: "Max file size",
    L_MAX_FILESIZE_EXPLAIN: "Max avatar file size",
    L_MAX_AVATAR_SIZE: "Max avatar dimensions",
    L_MAX_AVATAR_SIZE_EXPLAIN: "Width x Height in pixels",
    L_AVATAR_STORAGE_PATH: "Avatar storage path",
    L_AVATAR_STORAGE_PATH_EXPLAIN: "Path under webroot",
    L_AVATAR_GALLERY_PATH: "Avatar gallery path",
    L_AVATAR_GALLERY_PATH_EXPLAIN: "Path to gallery images",

    // COPPA
    L_COPPA_SETTINGS: "COPPA Settings",
    L_COPPA_FAX: "COPPA fax number",
    L_COPPA_MAIL: "COPPA mailing address",
    L_COPPA_MAIL_EXPLAIN: "Address for consent forms",

    // Email
    L_EMAIL_SETTINGS: "Email Settings",
    L_ADMIN_EMAIL: "Admin email address",
    L_EMAIL_SIG: "Email signature",
    L_EMAIL_SIG_EXPLAIN: "Appended to board emails",
    L_USE_SMTP: "Use SMTP",
    L_USE_SMTP_EXPLAIN: "Use external SMTP server",
    L_SMTP_SERVER: "SMTP server",
    L_SMTP_USERNAME: "SMTP username",
    L_SMTP_USERNAME_EXPLAIN: "Only if SMTP requires auth",
    L_SMTP_PASSWORD: "SMTP password",
    L_SMTP_PASSWORD_EXPLAIN: "Only if SMTP requires auth",

    // Values
    SERVER_NAME: cfg.server_name ?? "localhost",
    SERVER_PORT: cfg.server_port ?? "3000",
    SCRIPT_PATH: cfg.script_path ?? "/",
    SITENAME: cfg.sitename ?? "Plank Forum",
    SITE_DESCRIPTION: cfg.site_desc ?? "",
    S_DISABLE_BOARD_YES: cfg.board_disable === "1" ? markup('checked="checked"') : "",
    S_DISABLE_BOARD_NO: cfg.board_disable !== "1" ? markup('checked="checked"') : "",
    ACTIVATION_NONE: "0",
    ACTIVATION_USER: "1",
    ACTIVATION_ADMIN: "2",
    ACTIVATION_NONE_CHECKED: (cfg.require_activation ?? "0") === "0" ? markup('checked="checked"') : "",
    ACTIVATION_USER_CHECKED: cfg.require_activation === "1" ? markup('checked="checked"') : "",
    ACTIVATION_ADMIN_CHECKED: cfg.require_activation === "2" ? markup('checked="checked"') : "",
    CONFIRM_ENABLE: (cfg.enable_confirm ?? "1") === "1" ? markup('checked="checked"') : "",
    CONFIRM_DISABLE: cfg.enable_confirm === "0" ? markup('checked="checked"') : "",
    ALLOW_AUTOLOGIN_YES: (cfg.allow_autologin ?? "1") === "1" ? markup('checked="checked"') : "",
    ALLOW_AUTOLOGIN_NO: cfg.allow_autologin === "0" ? markup('checked="checked"') : "",
    AUTOLOGIN_TIME: cfg.max_autologin_time ?? "30",
    BOARD_EMAIL_FORM_ENABLE: (cfg.board_email_form ?? "1") === "1" ? markup('checked="checked"') : "",
    BOARD_EMAIL_FORM_DISABLE: cfg.board_email_form === "0" ? markup('checked="checked"') : "",
    FLOOD_INTERVAL: cfg.flood_interval ?? "15",
    SEARCH_FLOOD_INTERVAL: cfg.search_flood_interval ?? "15",
    MAX_LOGIN_ATTEMPTS: cfg.max_login_attempts ?? "5",
    LOGIN_RESET_TIME: cfg.login_reset_time ?? "30",
    TOPICS_PER_PAGE: cfg.topics_per_page ?? "25",
    POSTS_PER_PAGE: cfg.posts_per_page ?? "15",
    HOT_TOPIC: cfg.hot_threshold ?? "25",
    STYLE_SELECT: markup('<select name="default_style"><option value="Solaris" selected>Solaris</option></select>'),
    OVERRIDE_STYLE_YES: cfg.override_user_style === "1" ? markup('checked="checked"') : "",
    OVERRIDE_STYLE_NO: (cfg.override_user_style ?? "0") !== "1" ? markup('checked="checked"') : "",
    LANG_SELECT: markup('<select name="default_lang"><option value="english" selected>English</option></select>'),
    DEFAULT_DATEFORMAT: cfg.default_dateformat ?? "D M d, Y g:i a",
    TIMEZONE_SELECT: markup('<select name="board_timezone"><option value="0" selected>UTC</option></select>'),
    GZIP_YES: cfg.gzip_compress === "1" ? markup('checked="checked"') : "",
    GZIP_NO: (cfg.gzip_compress ?? "0") !== "1" ? markup('checked="checked"') : "",
    PRUNE_YES: cfg.prune_enable === "1" ? markup('checked="checked"') : "",
    PRUNE_NO: (cfg.prune_enable ?? "0") !== "1" ? markup('checked="checked"') : "",

    // Cookie
    COOKIE_DOMAIN: cfg.cookie_domain ?? "",
    COOKIE_NAME: cfg.cookie_name ?? "plank",
    COOKIE_PATH: cfg.cookie_path ?? "/",
    S_COOKIE_SECURE_ENABLED: cfg.cookie_secure === "1" ? markup('checked="checked"') : "",
    S_COOKIE_SECURE_DISABLED: (cfg.cookie_secure ?? "0") !== "1" ? markup('checked="checked"') : "",
    SESSION_LENGTH: cfg.session_length ?? "3600",

    // PM
    S_PRIVMSG_ENABLED: (cfg.privmsg_disable ?? "0") === "0" ? markup('checked="checked"') : "",
    S_PRIVMSG_DISABLED: cfg.privmsg_disable === "1" ? markup('checked="checked"') : "",
    INBOX_LIMIT: cfg.max_inbox_privmsgs ?? "50",
    SENTBOX_LIMIT: cfg.max_sentbox_privmsgs ?? "25",
    SAVEBOX_LIMIT: cfg.max_savebox_privmsgs ?? "50",

    // Abilities
    MAX_POLL_OPTIONS: cfg.max_poll_options ?? "10",
    HTML_YES: cfg.allow_html === "1" ? markup('checked="checked"') : "",
    HTML_NO: (cfg.allow_html ?? "0") !== "1" ? markup('checked="checked"') : "",
    HTML_TAGS: cfg.allow_html_tags ?? "",
    BBCODE_YES: (cfg.allow_bbcode ?? "1") === "1" ? markup('checked="checked"') : "",
    BBCODE_NO: cfg.allow_bbcode === "0" ? markup('checked="checked"') : "",
    SMILE_YES: (cfg.allow_smilies ?? "1") === "1" ? markup('checked="checked"') : "",
    SMILE_NO: cfg.allow_smilies === "0" ? markup('checked="checked"') : "",
    SMILIES_PATH: cfg.smilies_path ?? "images/smilies",
    SIG_YES: (cfg.allow_sig ?? "1") === "1" ? markup('checked="checked"') : "",
    SIG_NO: cfg.allow_sig === "0" ? markup('checked="checked"') : "",
    SIG_SIZE: cfg.max_sig_chars ?? "255",
    NAMECHANGE_YES: cfg.allow_namechange === "1" ? markup('checked="checked"') : "",
    NAMECHANGE_NO: (cfg.allow_namechange ?? "0") !== "1" ? markup('checked="checked"') : "",

    // Avatars
    AVATARS_LOCAL_YES: (cfg.allow_avatar_local ?? "1") === "1" ? markup('checked="checked"') : "",
    AVATARS_LOCAL_NO: cfg.allow_avatar_local === "0" ? markup('checked="checked"') : "",
    AVATARS_REMOTE_YES: (cfg.allow_avatar_remote ?? "1") === "1" ? markup('checked="checked"') : "",
    AVATARS_REMOTE_NO: cfg.allow_avatar_remote === "0" ? markup('checked="checked"') : "",
    AVATARS_UPLOAD_YES: (cfg.allow_avatar_upload ?? "1") === "1" ? markup('checked="checked"') : "",
    AVATARS_UPLOAD_NO: cfg.allow_avatar_upload === "0" ? markup('checked="checked"') : "",
    AVATAR_FILESIZE: cfg.avatar_filesize ?? "6291456",
    AVATAR_MAX_HEIGHT: cfg.avatar_max_height ?? "200",
    AVATAR_MAX_WIDTH: cfg.avatar_max_width ?? "200",
    AVATAR_PATH: cfg.avatar_path ?? "images/avatars",
    AVATAR_GALLERY_PATH: cfg.avatar_gallery_path ?? "images/avatars/gallery",

    // COPPA
    COPPA_FAX: cfg.coppa_fax ?? "",
    COPPA_MAIL: cfg.coppa_mail ?? "",

    // Email
    EMAIL_FROM: cfg.board_email ?? "admin@example.com",
    EMAIL_SIG: cfg.board_email_sig ?? "",
    SMTP_YES: cfg.smtp_delivery === "1" ? markup('checked="checked"') : "",
    SMTP_NO: (cfg.smtp_delivery ?? "0") !== "1" ? markup('checked="checked"') : "",
    SMTP_HOST: cfg.smtp_host ?? "",
    SMTP_USERNAME: cfg.smtp_username ?? "",
    SMTP_PASSWORD: cfg.smtp_password ?? "",
  });

  return c.html(renderAdmin(c, tpl));
});

admin.post("/admin/config", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const body = await c.req.parseBody();
  const adminDb = getSupabaseAdmin();

  // List of config fields we accept
  const configFields = [
    "server_name", "server_port", "script_path", "sitename", "site_desc",
    "board_disable", "require_activation", "enable_confirm", "allow_autologin",
    "max_autologin_time", "board_email_form", "flood_interval", "search_flood_interval",
    "max_login_attempts", "login_reset_time", "topics_per_page", "posts_per_page",
    "hot_threshold", "default_dateformat", "gzip_compress", "prune_enable",
    "cookie_domain", "cookie_name", "cookie_path", "cookie_secure", "session_length",
    "privmsg_disable", "max_inbox_privmsgs", "max_sentbox_privmsgs", "max_savebox_privmsgs",
    "max_poll_options", "allow_html", "allow_html_tags", "allow_bbcode", "allow_smilies",
    "smilies_path", "allow_sig", "max_sig_chars", "allow_namechange",
    "allow_avatar_local", "allow_avatar_remote", "allow_avatar_upload",
    "avatar_filesize", "avatar_max_height", "avatar_max_width", "avatar_path",
    "avatar_gallery_path", "coppa_fax", "coppa_mail",
    "board_email", "board_email_sig", "smtp_delivery", "smtp_host",
    "smtp_username", "smtp_password",
  ];

  for (const field of configFields) {
    if (body[field] !== undefined) {
      await adminDb.from("config").upsert({
        config_name: field,
        config_value: String(body[field]),
      });
    }
  }

  return c.redirect("/admin/config");
});

// ─── Forum/Category Management ───────────────────────────────

admin.get("/admin/forums", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const adminDb = getSupabaseAdmin();

  const { data: categories } = await adminDb
    .from("categories")
    .select("*")
    .order("cat_order");

  const { data: forums } = await adminDb
    .from("forums")
    .select("*")
    .order("cat_id")
    .order("forum_order");

  const tpl = adminRender("forum_admin_body.tpl");

  tpl.assignVars({
    L_FORUM_TITLE: "Forum Administration",
    L_FORUM_EXPLAIN: "Add, delete, edit, reorder and resynchronize categories and forums.",
    S_FORUM_ACTION: "/admin/forums",
    L_CREATE_FORUM: "Create new forum",
    L_CREATE_CATEGORY: "Create new category",
    L_EDIT: "Edit",
    L_DELETE: "Delete",
    L_MOVE_UP: "Move up",
    L_MOVE_DOWN: "Move down",
    L_RESYNC: "Resync",
  });

  if (categories) {
    for (const cat of categories) {
      const catForums = (forums ?? []).filter((f: any) => f.cat_id === cat.id);

      tpl.assignBlockVars("catrow", {
        CAT_DESC: cat.cat_title,
        U_VIEWCAT: "#",
        U_CAT_EDIT: `/admin/forums?mode=editcat&c=${cat.id}`,
        U_CAT_DELETE: `/admin/forum-action?mode=deletecat&c=${cat.id}&${csrfQueryParam(c)}`,
        U_CAT_MOVE_UP: `/admin/forums?mode=cat_order&c=${cat.id}&dir=up`,
        U_CAT_MOVE_DOWN: `/admin/forums?mode=cat_order&c=${cat.id}&dir=down`,
        S_ADD_FORUM_NAME: `forumname_${cat.id}`,
        S_ADD_FORUM_SUBMIT: `addforum_${cat.id}`,
      });

      for (const forum of catForums) {
        tpl.assignBlockVars("catrow.forumrow", {
          FORUM_NAME: forum.forum_name,
          FORUM_DESC: forum.forum_desc ?? "",
          NUM_TOPICS: String(forum.forum_topics),
          NUM_POSTS: String(forum.forum_posts),
          U_VIEWFORUM: `/viewforum/${forum.id}`,
          U_FORUM_EDIT: `/admin/forums?mode=editforum&f=${forum.id}`,
          U_FORUM_DELETE: `/admin/forum-action?mode=deleteforum&f=${forum.id}&${csrfQueryParam(c)}`,
          U_FORUM_MOVE_UP: `/admin/forums?mode=forum_order&f=${forum.id}&dir=up`,
          U_FORUM_MOVE_DOWN: `/admin/forums?mode=forum_order&f=${forum.id}&dir=down`,
          U_FORUM_RESYNC: `/admin/forums?mode=resync&f=${forum.id}`,
        });
      }
    }
  }

  return c.html(renderAdmin(c, tpl));
});

admin.post("/admin/forums", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const body = await c.req.parseBody();
  const adminDb = getSupabaseAdmin();

  // Create category
  if (body.addcategory && body.categoryname) {
    const { data: maxOrder } = await adminDb
      .from("categories")
      .select("cat_order")
      .order("cat_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    await adminDb.from("categories").insert({
      cat_title: String(body.categoryname),
      cat_order: (maxOrder?.cat_order ?? 0) + 10,
    });
    return c.redirect("/admin/forums");
  }

  // Create forum in category — look for addforum_<catId> submit
  for (const [key, val] of Object.entries(body)) {
    const match = key.match(/^addforum_(\d+)$/);
    if (match && val) {
      const catId = parseInt(match[1], 10);
      const forumName = body[`forumname_${catId}`] as string;
      if (forumName?.trim()) {
        const { data: maxOrder } = await adminDb
          .from("forums")
          .select("forum_order")
          .eq("cat_id", catId)
          .order("forum_order", { ascending: false })
          .limit(1)
          .maybeSingle();

        await adminDb.from("forums").insert({
          cat_id: catId,
          forum_name: forumName.trim(),
          forum_order: (maxOrder?.forum_order ?? 0) + 10,
        });
      }
      return c.redirect("/admin/forums");
    }
  }

  return c.redirect("/admin/forums");
});

// Category/forum ordering and deletion. These act on GET because the phpBB2
// admin template drives them with plain links; the token is carried in the
// query string and checked below.
admin.get("/admin/forum-action", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const mode = c.req.query("mode");
  // Link-triggered mutation on GET: the token middleware treats GET as safe,
  // so validate the token this route carries in its URL. Without it an
  // <img src> on any page an admin visits could fire these.
  if (!validateQueryCsrf(c)) return c.text("CSRF token mismatch", 403);
  const adminDb = getSupabaseAdmin();

  if (mode === "cat_order") {
    const catId = parseInt(c.req.query("c") ?? "0", 10);
    const dir = c.req.query("dir");
    if (!catId) return c.redirect("/admin/forums");

    const { data: cat } = await adminDb
      .from("categories")
      .select("cat_order")
      .eq("id", catId)
      .maybeSingle();
    if (!cat) return c.redirect("/admin/forums");

    const newOrder = dir === "up" ? cat.cat_order - 15 : cat.cat_order + 15;
    await adminDb.from("categories").update({ cat_order: newOrder }).eq("id", catId);
    await resequenceCategories(adminDb);
    return c.redirect("/admin/forums");
  }

  if (mode === "forum_order") {
    const forumId = parseInt(c.req.query("f") ?? "0", 10);
    const dir = c.req.query("dir");
    if (!forumId) return c.redirect("/admin/forums");

    const { data: forum } = await adminDb
      .from("forums")
      .select("forum_order, cat_id")
      .eq("id", forumId)
      .maybeSingle();
    if (!forum) return c.redirect("/admin/forums");

    const newOrder = dir === "up" ? forum.forum_order - 15 : forum.forum_order + 15;
    await adminDb.from("forums").update({ forum_order: newOrder }).eq("id", forumId);
    await resequenceForums(adminDb, forum.cat_id);
    return c.redirect("/admin/forums");
  }

  if (mode === "deletecat") {
    const catId = parseInt(c.req.query("c") ?? "0", 10);
    if (catId) {
      await adminDb.from("categories").delete().eq("id", catId);
    }
    return c.redirect("/admin/forums");
  }

  if (mode === "deleteforum") {
    const forumId = parseInt(c.req.query("f") ?? "0", 10);
    if (forumId) {
      await adminDb.from("forums").delete().eq("id", forumId);
    }
    return c.redirect("/admin/forums");
  }

  if (mode === "resync") {
    const forumId = parseInt(c.req.query("f") ?? "0", 10);
    if (forumId) {
      await resyncForum(adminDb, forumId);
    }
    return c.redirect("/admin/forums");
  }

  return c.redirect("/admin/forums");
});

// Edit category
admin.post("/admin/editcat", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const body = await c.req.parseBody();
  const catId = parseInt(body.cat_id as string, 10);
  const catTitle = (body.cat_title as string)?.trim();

  if (catId && catTitle) {
    const adminDb = getSupabaseAdmin();
    await adminDb.from("categories").update({ cat_title: catTitle }).eq("id", catId);
  }

  return c.redirect("/admin/forums");
});

// Edit forum
admin.post("/admin/editforum", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const body = await c.req.parseBody();
  const forumId = parseInt(body.forum_id as string, 10);

  if (!forumId) return c.redirect("/admin/forums");

  const adminDb = getSupabaseAdmin();
  const updates: Record<string, any> = {};

  if (body.forum_name) updates.forum_name = String(body.forum_name).trim();
  if (body.forum_desc !== undefined) updates.forum_desc = String(body.forum_desc);
  if (body.forum_status !== undefined) updates.forum_status = parseInt(body.forum_status as string, 10);
  if (body.cat_id !== undefined) updates.cat_id = parseInt(body.cat_id as string, 10);

  // Auth levels
  const authFields = [
    "auth_view", "auth_read", "auth_post", "auth_reply", "auth_edit",
    "auth_delete", "auth_sticky", "auth_announce", "auth_vote", "auth_pollcreate",
  ];
  for (const field of authFields) {
    if (body[field] !== undefined) {
      updates[field] = parseInt(body[field] as string, 10);
    }
  }

  if (Object.keys(updates).length > 0) {
    await adminDb.from("forums").update(updates).eq("id", forumId);
  }

  return c.redirect("/admin/forums");
});

// ─── Helpers ──────────────────────────────────────────────────

async function resequenceCategories(adminDb: any) {
  const { data: cats } = await adminDb
    .from("categories")
    .select("id")
    .order("cat_order");
  if (cats) {
    for (let i = 0; i < cats.length; i++) {
      await adminDb
        .from("categories")
        .update({ cat_order: (i + 1) * 10 })
        .eq("id", cats[i].id);
    }
  }
}

async function resequenceForums(adminDb: any, catId: number) {
  const { data: forums } = await adminDb
    .from("forums")
    .select("id")
    .eq("cat_id", catId)
    .order("forum_order");
  if (forums) {
    for (let i = 0; i < forums.length; i++) {
      await adminDb
        .from("forums")
        .update({ forum_order: (i + 1) * 10 })
        .eq("id", forums[i].id);
    }
  }
}

async function resyncForum(adminDb: any, forumId: number) {
  const { count: topicCount } = await adminDb
    .from("topics")
    .select("*", { count: "exact", head: true })
    .eq("forum_id", forumId)
    .neq("topic_status", 2);

  const { count: postCount } = await adminDb
    .from("posts")
    .select("*", { count: "exact", head: true })
    .eq("forum_id", forumId);

  const { data: lastPost } = await adminDb
    .from("posts")
    .select("id")
    .eq("forum_id", forumId)
    .order("post_time", { ascending: false })
    .limit(1)
    .maybeSingle();

  await adminDb
    .from("forums")
    .update({
      forum_topics: topicCount ?? 0,
      forum_posts: postCount ?? 0,
      forum_last_post_id: lastPost?.id ?? 0,
    })
    .eq("id", forumId);
}

// ─── User Management ─────────────────────────────────────────

admin.get("/admin/users", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const mode = c.req.query("mode");
  const username = c.req.query("username");
  const adminDb = getSupabaseAdmin();

  // If editing a specific user
  if (mode === "edit" && username) {
    const { data: profile } = await adminDb
      .from("profiles")
      .select("*")
      .eq("username", username)
      .maybeSingle();

    if (!profile) return c.text("User not found", 404);

    // No theme template for this view — there's user_edit_body.tpl in
    // Solaris but its variable surface is huge and inconsistent across
    // forks. The hand-rolled form is simpler than fighting the .tpl
    // and matches the visual idiom (forumline/thHead/row1/row2 from
    // subSilver.css).
    const editHtml = `
      <h1>Edit User: ${escapeHtml(profile.username)}</h1>
      <form method="post" action="/admin/users">
      ${formHiddenFields(c).html}
      <input type="hidden" name="user_id" value="${profile.id}" />
      <input type="hidden" name="mode" value="save" />
      <table cellspacing="1" cellpadding="4" border="0" class="forumline" width="100%">
        <tr><th class="thHead" colspan="2">User Details</th></tr>
        <tr><td class="row1">Username</td><td class="row2"><input class="post" type="text" name="username" value="${escapeHtml(profile.username)}" /></td></tr>
        <tr><td class="row1">User Level</td><td class="row2">
          <select name="user_level">
            <option value="${USER_LEVEL.USER}"${profile.user_level === USER_LEVEL.USER ? " selected" : ""}>User</option>
            <option value="${USER_LEVEL.MOD}"${profile.user_level === USER_LEVEL.MOD ? " selected" : ""}>Moderator</option>
            <option value="${USER_LEVEL.ADMIN}"${profile.user_level === USER_LEVEL.ADMIN ? " selected" : ""}>Admin</option>
          </select>
        </td></tr>
        <tr><td class="row1">Location</td><td class="row2"><input class="post" type="text" name="user_from" value="${escapeHtml(profile.user_from ?? "")}" /></td></tr>
        <tr><td class="row1">Signature</td><td class="row2"><textarea name="user_sig" rows="4" cols="40">${escapeHtml(profile.user_sig ?? "")}</textarea></td></tr>
        <tr><td class="row1">Active</td><td class="row2">
          <input type="radio" name="user_active" value="1"${profile.user_active ? ' checked' : ''} /> Yes
          <input type="radio" name="user_active" value="0"${!profile.user_active ? ' checked' : ''} /> No
        </td></tr>
        <tr><td class="catBottom" colspan="2" align="center">
          <input type="submit" name="submit" value="Update" class="mainoption" />
          &nbsp;<input type="submit" name="deleteuser" value="Delete User" class="liteoption" onclick="return confirm('Delete this user?')" />
        </td></tr>
      </table></form>`;

    return c.html(
      renderAdminPage({
        title: `Plank Forum :: Edit User ${profile.username}`,
        body: editHtml,
        currentUrl: new URL(c.req.url).pathname,
      })
    );
  }

  // Show user search form
  const tpl = adminRender("user_select_body.tpl");
  tpl.assignVars({
    L_USER_TITLE: "User Management",
    L_USER_EXPLAIN: "Search for a user to edit their profile.",
    L_USER_SELECT: "Select a user",
    L_LOOK_UP: "Look up",
    L_FIND_USERNAME: "Find a username",
    S_USER_ACTION: "/admin/users",
    S_HIDDEN_FIELDS: formHiddenFields(c),
    U_SEARCH_USER: "/search",
  });

  return c.html(renderAdmin(c, tpl));
});

admin.post("/admin/users", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const body = await c.req.parseBody();
  const adminDb = getSupabaseAdmin();

  // Search for user
  if (body.submituser && body.username) {
    return c.redirect(`/admin/users?mode=edit&username=${encodeURIComponent(body.username as string)}`);
  }

  // Save user edits
  if (body.mode === "save" && body.user_id) {
    const userId = body.user_id as string;

    if (body.deleteuser) {
      // Delete user
      await adminDb.from("topics").delete().eq("topic_poster", userId);
      await adminDb.auth.admin.deleteUser(userId);
      return c.redirect("/admin/users");
    }

    const updates: Record<string, any> = {};
    if (body.username) updates.username = String(body.username).trim();
    if (body.user_level !== undefined) updates.user_level = parseInt(body.user_level as string, 10);
    if (body.user_from !== undefined) updates.user_from = String(body.user_from);
    if (body.user_sig !== undefined) updates.user_sig = String(body.user_sig);
    if (body.user_active !== undefined) updates.user_active = body.user_active === "1";

    if (Object.keys(updates).length > 0) {
      await adminDb.from("profiles").update(updates).eq("id", userId);
    }

    return c.redirect(`/admin/users?mode=edit&username=${encodeURIComponent(updates.username ?? "")}`);
  }

  return c.redirect("/admin/users");
});

// ─── Ban Management ──────────────────────────────────────────

admin.get("/admin/bans", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const adminDb = getSupabaseAdmin();

  // Get current bans
  const { data: bans } = await adminDb
    .from("banlist")
    .select("*, profiles(username)")
    .order("ban_start", { ascending: false });

  // Build unban selects
  let userUnbanSelect = '<select name="unban_userid" multiple size="5">';
  let emailUnbanSelect = '<select name="unban_email" multiple size="5">';
  let ipUnbanSelect = '<select name="unban_ip" multiple size="5">';

  if (bans) {
    for (const ban of bans) {
      if (ban.ban_userid) {
        const username = (ban.profiles as any)?.username ?? ban.ban_userid;
        userUnbanSelect += `<option value="${ban.id}">${escapeHtml(String(username))} (${escapeHtml(ban.ban_reason ?? "no reason")})</option>`;
      }
      if (ban.ban_email) {
        emailUnbanSelect += `<option value="${ban.id}">${escapeHtml(ban.ban_email)}</option>`;
      }
    }
  }

  userUnbanSelect += "</select>";
  emailUnbanSelect += "</select>";
  ipUnbanSelect += "</select>";

  const tpl = adminRender("user_ban_body.tpl");

  tpl.assignVars({
    L_BAN_TITLE: "Ban Management",
    L_BAN_EXPLAIN: "Manage user, email, and IP bans.",
    S_BANLIST_ACTION: "/admin/bans",
    L_BAN_USER: "Ban User",
    L_UNBAN_USER: "Unban User",
    L_UNBAN_USER_EXPLAIN: "Select users to unban",
    L_BAN_IP: "Ban IP",
    L_BAN_IP_EXPLAIN: "Enter an IP address to ban",
    L_UNBAN_IP: "Unban IP",
    L_UNBAN_IP_EXPLAIN: "Select IPs to unban",
    L_BAN_EMAIL: "Ban Email",
    L_BAN_EMAIL_EXPLAIN: "Enter an email pattern to ban (e.g. *@spam.com)",
    L_UNBAN_EMAIL: "Unban Email",
    L_UNBAN_EMAIL_EXPLAIN: "Select emails to unban",
    L_BAN_EXPLAIN_WARN: "Bans take effect immediately.",
    L_USERNAME: "Username",
    L_IP_OR_HOSTNAME: "IP Address",
    L_EMAIL_ADDRESS: "Email Address",
    L_FIND_USERNAME: "Find a username",
    L_SUBMIT: "Submit",
    L_RESET: "Reset",
    S_HIDDEN_FIELDS: formHiddenFields(c),
    U_SEARCH_USER: "/search",
    S_UNBAN_USERLIST_SELECT: markup(userUnbanSelect),
    S_UNBAN_IPLIST_SELECT: markup(ipUnbanSelect),
    S_UNBAN_EMAILLIST_SELECT: markup(emailUnbanSelect),
  });

  return c.html(renderAdmin(c, tpl));
});

admin.post("/admin/bans", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const body = await c.req.parseBody();
  const adminDb = getSupabaseAdmin();

  // Ban user
  if (body.username && (body.username as string).trim()) {
    const username = (body.username as string).trim();
    const { data: profile } = await adminDb
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (profile) {
      await adminDb.from("banlist").insert({
        ban_userid: profile.id,
        ban_reason: `Banned by admin`,
      });
    }
  }

  // Ban email
  if (body.ban_email && (body.ban_email as string).trim()) {
    await adminDb.from("banlist").insert({
      ban_email: (body.ban_email as string).trim(),
      ban_reason: "Email banned by admin",
    });
  }

  // Unban user
  if (body.unban_userid) {
    const ids = Array.isArray(body.unban_userid)
      ? body.unban_userid.map(Number)
      : [Number(body.unban_userid)];
    for (const id of ids) {
      await adminDb.from("banlist").delete().eq("id", id);
    }
  }

  // Unban email
  if (body.unban_email) {
    const ids = Array.isArray(body.unban_email)
      ? body.unban_email.map(Number)
      : [Number(body.unban_email)];
    for (const id of ids) {
      await adminDb.from("banlist").delete().eq("id", id);
    }
  }

  return c.redirect("/admin/bans");
});

// ─── Rank Management ─────────────────────────────────────────

admin.get("/admin/ranks", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const adminDb = getSupabaseAdmin();
  const { data: ranks } = await adminDb
    .from("ranks")
    .select("*")
    .order("rank_min");

  const tpl = adminRender("ranks_list_body.tpl");

  tpl.assignVars({
    L_RANKS_TITLE: "Rank Management",
    L_RANKS_TEXT: "Manage user ranks displayed below usernames.",
    S_RANKS_ACTION: "/admin/ranks",
    L_RANK: "Rank",
    L_RANK_MINIMUM: "Minimum Posts",
    L_SPECIAL_RANK: "Special Rank",
    L_EDIT: "Edit",
    L_DELETE: "Delete",
    L_ADD_RANK: "Add new rank",
  });

  if (ranks) {
    let rowIndex = 0;
    for (const rank of ranks) {
      tpl.assignBlockVars("ranks", {
        ROW_CLASS: rowIndex % 2 === 0 ? "row1" : "row2",
        RANK: rank.rank_title + (rank.rank_image ? ` <img src="${rank.rank_image}" alt="" />` : ""),
        RANK_MIN: rank.rank_special ? "-" : String(rank.rank_min),
        SPECIAL_RANK: rank.rank_special ? "Yes" : "No",
        U_RANK_EDIT: `/admin/ranks?mode=edit&id=${rank.id}`,
        U_RANK_DELETE: `/admin/rank-action?mode=delete&id=${rank.id}&${csrfQueryParam(c)}`,
      });
      rowIndex++;
    }
  }

  return c.html(renderAdmin(c, tpl));
});

admin.post("/admin/ranks", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const body = await c.req.parseBody();
  const adminDb = getSupabaseAdmin();

  if (body.add || body.save) {
    const rankTitle = (body.rank_title as string)?.trim();
    if (!rankTitle) return c.redirect("/admin/ranks");

    const rankData: Record<string, any> = {
      rank_title: rankTitle,
      rank_min: parseInt(body.rank_min as string, 10) || 0,
      rank_special: body.rank_special === "1",
      rank_image: (body.rank_image as string)?.trim() || null,
    };

    if (body.rank_id) {
      await adminDb
        .from("ranks")
        .update(rankData)
        .eq("id", parseInt(body.rank_id as string, 10));
    } else {
      await adminDb.from("ranks").insert(rankData);
    }
  }

  return c.redirect("/admin/ranks");
});


// ─── Smilies Management ──────────────────────────────────────

admin.get("/admin/smilies", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const adminDb = getSupabaseAdmin();
  const { data: smilies } = await adminDb
    .from("smilies")
    .select("*")
    .order("smilies_order");

  const tpl = adminRender("smile_list_body.tpl");

  tpl.assignVars({
    L_SMILEY_TITLE: "Smiley Management",
    L_SMILEY_TEXT: "Add, edit, and remove smilies available to users.",
    S_SMILEY_ACTION: "/admin/smilies",
    L_CODE: "Code",
    L_SMILE: "Smiley",
    L_EMOT: "Emotion",
    L_ACTION: "Action",
    L_EDIT: "Edit",
    L_DELETE: "Delete",
    L_SMILEY_ADD: "Add new smiley",
    L_IMPORT_PACK: "Import Pack",
    L_EXPORT_PACK: "Export Pack",
    S_HIDDEN_FIELDS: formHiddenFields(c),
  });

  if (smilies) {
    let rowIndex = 0;
    for (const smiley of smilies) {
      tpl.assignBlockVars("smiles", {
        ROW_CLASS: rowIndex % 2 === 0 ? "row1" : "row2",
        CODE: smiley.code,
        SMILEY_IMG: smiley.smile_url,
        EMOT: smiley.emoticon ?? "",
        U_SMILEY_EDIT: `/admin/smilies?mode=edit&id=${smiley.id}`,
        U_SMILEY_DELETE: `/admin/smiley-action?mode=delete&id=${smiley.id}&${csrfQueryParam(c)}`,
      });
      rowIndex++;
    }
  }

  return c.html(renderAdmin(c, tpl));
});

admin.post("/admin/smilies", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const body = await c.req.parseBody();
  const adminDb = getSupabaseAdmin();

  if (body.add || body.save) {
    const code = (body.code as string)?.trim();
    const smileUrl = (body.smile_url as string)?.trim();
    const emoticon = (body.emoticon as string)?.trim() || "";

    if (!code || !smileUrl) return c.redirect("/admin/smilies");

    const smileyData = { code, smile_url: smileUrl, emoticon };

    if (body.smiley_id) {
      await adminDb
        .from("smilies")
        .update(smileyData)
        .eq("id", parseInt(body.smiley_id as string, 10));
    } else {
      await adminDb.from("smilies").insert(smileyData);
    }
    clearSmiliesCache();
  }

  return c.redirect("/admin/smilies");
});

// ─── Word Censor Management ──────────────────────────────────

admin.get("/admin/words", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const adminDb = getSupabaseAdmin();
  const { data: words } = await adminDb
    .from("word_censors")
    .select("*")
    .order("id");

  const tpl = adminRender("words_list_body.tpl");

  tpl.assignVars({
    L_WORDS_TITLE: "Word Censor Management",
    L_WORDS_TEXT: "Manage word filters applied to post content.",
    S_WORDS_ACTION: "/admin/words",
    L_WORD: "Word",
    L_REPLACEMENT: "Replacement",
    L_ACTION: "Action",
    L_EDIT: "Edit",
    L_DELETE: "Delete",
    L_ADD_WORD: "Add new word",
    S_HIDDEN_FIELDS: formHiddenFields(c),
  });

  if (words) {
    let rowIndex = 0;
    for (const word of words) {
      tpl.assignBlockVars("words", {
        ROW_CLASS: rowIndex % 2 === 0 ? "row1" : "row2",
        WORD: word.word,
        REPLACEMENT: word.replacement,
        U_WORD_EDIT: `/admin/words?mode=edit&id=${word.id}`,
        U_WORD_DELETE: `/admin/word-action?mode=delete&id=${word.id}&${csrfQueryParam(c)}`,
      });
      rowIndex++;
    }
  }

  return c.html(renderAdmin(c, tpl));
});

admin.post("/admin/words", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const body = await c.req.parseBody();
  const adminDb = getSupabaseAdmin();

  if (body.add || body.save) {
    const word = (body.word as string)?.trim();
    const replacement = (body.replacement as string)?.trim() || "";

    if (!word) return c.redirect("/admin/words");

    const wordData = { word, replacement };

    if (body.word_id) {
      await adminDb
        .from("word_censors")
        .update(wordData)
        .eq("id", parseInt(body.word_id as string, 10));
    } else {
      await adminDb.from("word_censors").insert(wordData);
    }
    clearCensorCache();
  }

  // Handle delete via query param
  if (body.delete_id) {
    await adminDb
      .from("word_censors")
      .delete()
      .eq("id", parseInt(body.delete_id as string, 10));
    clearCensorCache();
  }

  return c.redirect("/admin/words");
});

// Delete actions via GET for words, smilies, ranks
admin.get("/admin/word-action", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const mode = c.req.query("mode");
  // Link-triggered mutation on GET: the token middleware treats GET as safe,
  // so validate the token this route carries in its URL. Without it an
  // <img src> on any page an admin visits could fire these.
  if (!validateQueryCsrf(c)) return c.text("CSRF token mismatch", 403);
  const id = parseInt(c.req.query("id") ?? "0", 10);
  if (!id) return c.redirect("/admin/words");

  const adminDb = getSupabaseAdmin();
  if (mode === "delete") {
    await adminDb.from("word_censors").delete().eq("id", id);
    clearCensorCache();
  }
  return c.redirect("/admin/words");
});

admin.get("/admin/smiley-action", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const mode = c.req.query("mode");
  // Link-triggered mutation on GET: the token middleware treats GET as safe,
  // so validate the token this route carries in its URL. Without it an
  // <img src> on any page an admin visits could fire these.
  if (!validateQueryCsrf(c)) return c.text("CSRF token mismatch", 403);
  const id = parseInt(c.req.query("id") ?? "0", 10);
  if (!id) return c.redirect("/admin/smilies");

  const adminDb = getSupabaseAdmin();
  if (mode === "delete") {
    await adminDb.from("smilies").delete().eq("id", id);
    clearSmiliesCache();
  }
  return c.redirect("/admin/smilies");
});

admin.get("/admin/rank-action", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const mode = c.req.query("mode");
  // Link-triggered mutation on GET: the token middleware treats GET as safe,
  // so validate the token this route carries in its URL. Without it an
  // <img src> on any page an admin visits could fire these.
  if (!validateQueryCsrf(c)) return c.text("CSRF token mismatch", 403);
  const id = parseInt(c.req.query("id") ?? "0", 10);
  if (!id) return c.redirect("/admin/ranks");

  const adminDb = getSupabaseAdmin();
  if (mode === "delete") {
    await adminDb.from("ranks").delete().eq("id", id);
  }
  return c.redirect("/admin/ranks");
});

// ─── Permission Management ────────────────────────────────────
//
// Three pages:
//   /admin/auth                — pick a forum or group to edit
//   /admin/auth/forum/:id      — set the forums.auth_* enum levels
//                                (ALL/REG/ACL/MOD/ADMIN) for one forum
//   /admin/auth/group/:id      — set the auth_access bits for one
//                                group across every forum (matrix UI)
//
// The forum page drives the *required* level for each action; the
// group page drives which groups satisfy ACL-level requirements.

const AUTH_LEVELS_LABELS: Array<[number, string]> = [
  [0, "ALL"],
  [1, "REG"],
  [2, "PRIVATE"],
  [3, "MOD"],
  [5, "ADMIN"],
];

const FORUM_AUTH_COLUMNS = [
  "auth_view",
  "auth_read",
  "auth_post",
  "auth_reply",
  "auth_edit",
  "auth_delete",
  "auth_sticky",
  "auth_announce",
  "auth_vote",
  "auth_pollcreate",
] as const;

function authLevelSelect(name: string, current: number): string {
  const opts = AUTH_LEVELS_LABELS.map(
    ([val, label]) =>
      `<option value="${val}"${val === current ? " selected=\"selected\"" : ""}>${label}</option>`
  ).join("");
  return `<select name="${name}">${opts}</select>`;
}

admin.get("/admin/auth", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const adminDb = getSupabaseAdmin();
  // Single-user groups (group_single_user=true) are reserved for the
  // per-user permission-override path we deferred from Chunk 17 —
  // hide them from the admin UI to avoid accidentally hooking them
  // into the group-permission flow.
  const [{ data: forums }, { data: groups }] = await Promise.all([
    adminDb.from("forums").select("id, forum_name").order("forum_order"),
    adminDb
      .from("groups")
      .select("id, group_name")
      .eq("group_single_user", false)
      .order("group_name"),
  ]);

  const forumRows = (forums ?? [])
    .map(
      (f: any) =>
        `<tr><td><a href="/admin/auth/forum/${f.id}">${escapeHtml(f.forum_name)}</a></td></tr>`
    )
    .join("");
  const groupRows = (groups ?? [])
    .map(
      (g: any) =>
        `<tr><td><a href="/admin/auth/group/${g.id}">${escapeHtml(g.group_name)}</a></td></tr>`
    )
    .join("");

  // Plank-authored landing page (no phpBB2 template for this — the
  // closest is auth_select_body.tpl, which assumes a single picker).
  // Two side-by-side lists let the admin jump straight into either
  // a forum's required-level dropdowns or a group's access matrix.
  const body =
    `<h1>Permission Management</h1>` +
    `<p>Choose a forum to set its required permission levels, or a ` +
    `group to set its per-forum access bits.</p>` +
    `<table cellspacing="1" cellpadding="4" border="0" align="center" class="forumline">` +
    `<tr><th class="thHead">Forums</th></tr>${forumRows}` +
    `<tr><th class="thHead">Groups</th></tr>${groupRows}` +
    `</table>`;
  return c.html(
    renderAdminPage({
      title: "Plank Forum :: Permission Management",
      body,
      currentUrl: new URL(c.req.url).pathname,
    })
  );
});

admin.get("/admin/auth/forum/:id", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const forumId = parseInt(c.req.param("id"), 10);
  const adminDb = getSupabaseAdmin();

  const { data: forum } = await adminDb
    .from("forums")
    .select("*")
    .eq("id", forumId)
    .maybeSingle();
  if (!forum) return c.text("Forum not found", 404);

  const tpl = adminRender("auth_forum_body.tpl");

  tpl.assignVars({
    L_AUTH_TITLE: "Forum Permission Control",
    L_AUTH_EXPLAIN: markup(
      "Here you can set the required permission level for each action " +
        "on this forum. <b>ALL</b>=everyone, <b>REG</b>=registered users, " +
        "<b>PRIVATE</b>=members of a group with the matching bit (set on the " +
        "group page), <b>MOD</b>=moderators of this forum, <b>ADMIN</b>=administrators."
    ),
    FORUM_NAME: forum.forum_name,
    S_FORUMAUTH_ACTION: `/admin/auth/forum/${forumId}`,
    L_SUBMIT: "Submit",
    L_RESET: "Reset",
    S_COLUMN_SPAN: String(FORUM_AUTH_COLUMNS.length),
    S_HIDDEN_FIELDS: formHiddenFields(c),
    U_SWITCH_MODE: markup(
      `<a href="/admin/auth">Back to permission management</a>`
    ),
  });

  // Header row: one <th> per action.
  for (const col of FORUM_AUTH_COLUMNS) {
    tpl.assignBlockVars("forum_auth_titles", {
      CELL_TITLE: col.replace(/^auth_/, "").replace(/^./, (m) => m.toUpperCase()),
    });
  }
  // Data row: one <select> per action, pre-selected to the current value.
  for (const col of FORUM_AUTH_COLUMNS) {
    tpl.assignBlockVars("forum_auth_data", {
      S_AUTH_LEVELS_SELECT: markup(
        authLevelSelect(col, (forum as any)[col] as number)
      ),
    });
  }

  return c.html(renderAdmin(c, tpl));
});

admin.post("/admin/auth/forum/:id", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const forumId = parseInt(c.req.param("id"), 10);
  const body = await c.req.parseBody();
  const adminDb = getSupabaseAdmin();

  // Build the update payload from the columns we know about, clamping
  // to known auth levels so a tampered form can't write garbage.
  const validLevels = new Set([0, 1, 2, 3, 5]);
  const updates: Record<string, number> = {};
  for (const col of FORUM_AUTH_COLUMNS) {
    const raw = parseInt(body[col] as string, 10);
    if (validLevels.has(raw)) updates[col] = raw;
  }
  if (Object.keys(updates).length > 0) {
    await adminDb.from("forums").update(updates).eq("id", forumId);
  }
  return c.redirect(`/admin/auth/forum/${forumId}`);
});

admin.get("/admin/auth/group/:id", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const groupId = parseInt(c.req.param("id"), 10);
  const adminDb = getSupabaseAdmin();

  const { data: group } = await adminDb
    .from("groups")
    .select("id, group_name, group_single_user")
    .eq("id", groupId)
    .maybeSingle();
  // Single-user groups are reserved; treat as not-found from the
  // admin's perspective so the permission UI can't drive them.
  if (!group || (group as any).group_single_user) return c.text("Group not found", 404);

  const [{ data: forums }, { data: accessRows }] = await Promise.all([
    adminDb.from("forums").select("id, forum_name").order("forum_order"),
    adminDb.from("auth_access").select("*").eq("group_id", groupId),
  ]);

  const accessByForum: Record<number, any> = {};
  for (const r of accessRows ?? []) accessByForum[(r as any).forum_id] = r;

  const aclColumns = FORUM_AUTH_COLUMNS;

  const tpl = adminRender("auth_ug_body.tpl");

  tpl.assignVars({
    L_AUTH_TITLE: "Group Permissions",
    L_AUTH_EXPLAIN: markup(
      "Check a box to grant this group the corresponding permission " +
        "on each forum. The boxes only matter for forums whose action " +
        "level is set to <b>PRIVATE</b>. The <b>Mod</b> column makes " +
        "this group a moderator of the forum (passes MOD-level gates " +
        "and grants modcp access)."
    ),
    L_USER_OR_GROUPNAME: "Group name",
    USERNAME: group.group_name,
    L_PERMISSIONS: "Per-forum permissions",
    L_FORUM: "Forum",
    L_MODERATOR_STATUS: "Mod",
    S_AUTH_ACTION: `/admin/auth/group/${groupId}`,
    L_SUBMIT: "Submit",
    L_RESET: "Reset",
    S_HIDDEN_FIELDS: formHiddenFields(c),
    S_COLUMN_SPAN: String(aclColumns.length + 2),
    U_SWITCH_MODE: markup(
      `<a href="/admin/auth">Back to permission management</a>`
    ),
  });
  tpl.assignBlockVars("switch_group_auth", {
    GROUP_MEMBERSHIP: markup(
      `Editing permissions for group <b>${escapeHtml(group.group_name)}</b>`
    ),
  });

  // Column headers — one per ACL action.
  for (const col of aclColumns) {
    tpl.assignBlockVars("acltype", {
      L_UG_ACL_TYPE: col.replace(/^auth_/, ""),
    });
  }

  // One row per forum: a checkbox per ACL action + one for auth_mod.
  let i = 0;
  for (const f of forums ?? []) {
    const row = accessByForum[(f as any).id] ?? {};
    const rowClass = i++ % 2 === 0 ? "row1" : "row2";
    tpl.assignBlockVars("forums", {
      ROW_CLASS: rowClass,
      FORUM_NAME: (f as any).forum_name,
      S_MOD_SELECT: markup(
        `<input type="checkbox" name="mod_${(f as any).id}" value="1"${row.auth_mod ? " checked=\"checked\"" : ""} />`
      ),
    });
    for (const col of aclColumns) {
      tpl.assignBlockVars("forums.aclvalues", {
        S_ACL_SELECT: markup(
          `<input type="checkbox" name="${col}_${(f as any).id}" value="1"${row[col] ? " checked=\"checked\"" : ""} />`
        ),
      });
    }
  }

  return c.html(renderAdmin(c, tpl));
});

admin.post("/admin/auth/group/:id", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const groupId = parseInt(c.req.param("id"), 10);
  const body = await c.req.parseBody();
  const adminDb = getSupabaseAdmin();

  // Gather every forum mentioned in the form. Any forum without any
  // checked box yields a row of all-false (so we can clear bits, not
  // just set them).
  const { data: forums } = await adminDb.from("forums").select("id");
  const forumIds = (forums ?? []).map((f: any) => f.id as number);

  const upserts: any[] = [];
  for (const fid of forumIds) {
    const row: any = { group_id: groupId, forum_id: fid };
    let hasAnyBit = false;
    for (const col of FORUM_AUTH_COLUMNS) {
      const bit = body[`${col}_${fid}`] === "1";
      row[col] = bit;
      if (bit) hasAnyBit = true;
    }
    const modBit = body[`mod_${fid}`] === "1";
    row.auth_mod = modBit;
    if (modBit) hasAnyBit = true;
    // Only persist rows that grant at least one bit; otherwise clear
    // any existing row for this forum. Keeps auth_access sparse and
    // avoids confusing all-false rows in the admin UI.
    if (hasAnyBit) upserts.push(row);
  }

  // Delete-then-insert is simpler than computing a per-forum upsert
  // diff; the table is small and only touched from admin actions.
  await adminDb.from("auth_access").delete().eq("group_id", groupId);
  if (upserts.length > 0) {
    await adminDb.from("auth_access").insert(upserts);
  }
  return c.redirect(`/admin/auth/group/${groupId}`);
});

// ─── Group Management ─────────────────────────────────────────
//
// CRUD for the `groups` table — list, create, edit, delete — plus
// per-group member management. Single-user groups
// (`groups.group_single_user = true`) are reserved for the per-user
// permission-override path we deferred from Chunk 17; the admin UI
// hides them everywhere.

const GROUP_TYPE = { OPEN: 0, CLOSED: 1, HIDDEN: 2 } as const;

function groupTypeLabel(t: number): string {
  if (t === GROUP_TYPE.OPEN) return "Open";
  if (t === GROUP_TYPE.HIDDEN) return "Hidden";
  return "Closed";
}

/**
 * Resolve `groups.group_moderator` (a profile UUID) to the matching
 * username, defaulting to an empty string for unset moderators.
 */
async function resolveModeratorName(
  adminDb: ReturnType<typeof getSupabaseAdmin>,
  moderatorId: string | null | undefined
): Promise<string> {
  if (!moderatorId) return "";
  const { data } = await adminDb
    .from("profiles")
    .select("username")
    .eq("id", moderatorId)
    .maybeSingle();
  return (data as any)?.username ?? "";
}

admin.get("/admin/groups", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const adminDb = getSupabaseAdmin();
  const { data: groups } = await adminDb
    .from("groups")
    .select("id, group_name, group_type, group_moderator")
    .eq("group_single_user", false)
    .order("group_name");

  // Member counts in one round-trip, then aggregated in JS — there's
  // no GROUP BY on the supabase-js surface and the group list is
  // small enough that grouping client-side beats N queries.
  const { data: memberships } = await adminDb
    .from("user_group")
    .select("group_id")
    .eq("user_pending", false);
  const memberCounts: Record<number, number> = {};
  for (const m of memberships ?? []) {
    const gid = (m as any).group_id as number;
    memberCounts[gid] = (memberCounts[gid] ?? 0) + 1;
  }

  const rows = (groups ?? [])
    .map((g: any, i: number) => {
      const cls = i % 2 === 0 ? "row1" : "row2";
      return (
        `<tr>` +
          `<td class="${cls}">${escapeHtml(g.group_name)}</td>` +
          `<td class="${cls}">${groupTypeLabel(g.group_type)}</td>` +
          `<td class="${cls}" align="center">${memberCounts[g.id] ?? 0}</td>` +
          `<td class="${cls}" align="center">` +
            `<a href="/admin/groups/${g.id}/edit">Edit</a> &middot; ` +
            `<a href="/admin/groups/${g.id}/members">Members</a> &middot; ` +
            `<a href="/admin/auth/group/${g.id}">Permissions</a>` +
          `</td>` +
        `</tr>`
      );
    })
    .join("");

  const body =
    `<h1>Group Management</h1>` +
    `<p>Groups are the unit of permission assignment — a group's bits ` +
    `in <a href="/admin/auth">Permissions</a> apply to every member.</p>` +
    `<table cellspacing="1" cellpadding="4" border="0" align="center" class="forumline" width="100%">` +
      `<tr>` +
        `<th class="thHead">Name</th>` +
        `<th class="thHead">Type</th>` +
        `<th class="thHead">Members</th>` +
        `<th class="thHead">Actions</th>` +
      `</tr>` +
      (rows || `<tr><td class="row1" colspan="4" align="center">No groups yet.</td></tr>`) +
    `</table>` +
    `<p align="center"><a href="/admin/groups/new" class="mainoption">Create new group</a></p>`;

  return c.html(
    renderAdminPage({
      title: "Plank Forum :: Group Management",
      body,
      currentUrl: new URL(c.req.url).pathname,
    })
  );
});

/**
 * Render the group create/edit form. Used by both `/admin/groups/new`
 * (no existing group) and `/admin/groups/:id/edit` (populated).
 */
function renderGroupEditForm(
  c: Context,
  opts: {
    isEdit: boolean;
    groupName: string;
    groupDescription: string;
    groupType: number;
    moderatorUsername: string;
    actionUrl: string;
    title: string;
    groupId?: number;
  }
): string {
  const tpl = adminRender("group_edit_body.tpl");
  tpl.assignVars({
    L_GROUP_TITLE: opts.title,
    L_GROUP_EDIT_DELETE: opts.isEdit ? "Edit Group" : "Create New Group",
    L_ITEMS_REQUIRED: "Items marked with * are required.",
    L_GROUP_NAME: "Group name",
    L_GROUP_DESCRIPTION: "Description",
    L_GROUP_MODERATOR: "Moderator (username)",
    L_FIND_USERNAME: "Find username",
    L_GROUP_STATUS: "Status",
    L_GROUP_OPEN: "Open (anyone can join)",
    L_GROUP_CLOSED: "Closed (admin/leader approves)",
    L_GROUP_HIDDEN: "Hidden (not listed publicly)",
    L_DELETE_MODERATOR: "Clear moderator",
    L_DELETE_MODERATOR_EXPLAIN: "Remove the moderator without picking a new one.",
    L_GROUP_DELETE: "Delete group",
    L_GROUP_DELETE_CHECK: "Tick to delete this group (cannot be undone)",
    L_YES: "Yes",
    L_SUBMIT: "Submit",
    L_RESET: "Reset",
    GROUP_NAME: opts.groupName,
    GROUP_DESCRIPTION: opts.groupDescription,
    GROUP_MODERATOR: opts.moderatorUsername,
    S_GROUP_ACTION: opts.actionUrl,
    S_HIDDEN_FIELDS: formHiddenFields(c),
    S_GROUP_OPEN_TYPE: String(GROUP_TYPE.OPEN),
    S_GROUP_CLOSED_TYPE: String(GROUP_TYPE.CLOSED),
    S_GROUP_HIDDEN_TYPE: String(GROUP_TYPE.HIDDEN),
    S_GROUP_OPEN_CHECKED: opts.groupType === GROUP_TYPE.OPEN ? "checked" : "",
    S_GROUP_CLOSED_CHECKED: opts.groupType === GROUP_TYPE.CLOSED ? "checked" : "",
    S_GROUP_HIDDEN_CHECKED: opts.groupType === GROUP_TYPE.HIDDEN ? "checked" : "",
    // The template's onclick popup expects a URL; we don't have a
    // dedicated user search popup, so point at the memberlist.
    U_SEARCH_USER: "/memberlist",
  });
  // The {S_HIDDEN_FIELDS} slot in the template doesn't carry the
  // record id we're editing, so emit an extra hidden input via the
  // overridable text — but more reliably, we just include it inside
  // the form by appending to the rendered body. Simpler: stuff an
  // extra <input> into the form via the hidden-fields slot.
  if (opts.isEdit && opts.groupId !== undefined) {
    tpl.assignVars({
      S_HIDDEN_FIELDS: markup(
        formHiddenFields(c).html +
        `<input type="hidden" name="group_id" value="${opts.groupId}" />`
      ),
    });
  }
  // Only show "delete moderator" / "delete group" rows in edit mode.
  if (opts.isEdit) tpl.assignBlockVars("group_edit", {});

  return renderAdminPage({
    title: `Plank Forum :: ${opts.title}`,
    body: tpl.render("body"),
    currentUrl: new URL(c.req.url).pathname,
  });
}

admin.get("/admin/groups/new", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  return c.html(
    renderGroupEditForm(c, {
      isEdit: false,
      groupName: "",
      groupDescription: "",
      groupType: GROUP_TYPE.CLOSED,
      moderatorUsername: "",
      actionUrl: "/admin/groups/new",
      title: "Create Group",
    })
  );
});

admin.post("/admin/groups/new", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const body = await c.req.parseBody();
  const adminDb = getSupabaseAdmin();

  const name = ((body.group_name as string) ?? "").trim();
  if (!name) return c.text("Group name is required", 400);

  // Resolve moderator username → profile id, if supplied.
  const modUsername = ((body.username as string) ?? "").trim();
  let moderatorId: string | null = null;
  if (modUsername) {
    const { data: profile } = await adminDb
      .from("profiles")
      .select("id")
      .eq("username", modUsername)
      .maybeSingle();
    if (!profile) return c.text(`User '${modUsername}' not found`, 400);
    moderatorId = (profile as any).id;
  }

  const groupType = parseInt(body.group_type as string, 10);
  const validType = [0, 1, 2].includes(groupType) ? groupType : GROUP_TYPE.CLOSED;

  const { data: created, error } = await adminDb
    .from("groups")
    .insert({
      group_name: name,
      group_description: ((body.group_description as string) ?? "").trim(),
      group_type: validType,
      group_moderator: moderatorId,
      group_single_user: false,
    })
    .select()
    .single();
  if (error || !created) return c.text(`Failed to create group: ${error?.message ?? "unknown"}`, 500);

  return c.redirect(`/admin/groups/${(created as any).id}/edit`);
});

admin.get("/admin/groups/:id/edit", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const groupId = parseInt(c.req.param("id"), 10);
  const adminDb = getSupabaseAdmin();
  const { data: group } = await adminDb
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) return c.text("Group not found", 404);

  const modName = await resolveModeratorName(adminDb, (group as any).group_moderator);

  return c.html(
    renderGroupEditForm(c, {
      isEdit: true,
      groupId,
      groupName: (group as any).group_name,
      groupDescription: (group as any).group_description ?? "",
      groupType: (group as any).group_type,
      moderatorUsername: modName,
      actionUrl: `/admin/groups/${groupId}/edit`,
      title: `Edit Group: ${(group as any).group_name}`,
    })
  );
});

admin.post("/admin/groups/:id/edit", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const groupId = parseInt(c.req.param("id"), 10);
  const body = await c.req.parseBody();
  const adminDb = getSupabaseAdmin();

  // Delete path — checkbox in the edit form. user_group + auth_access
  // FKs cascade, so this is single-statement.
  if (body.group_delete === "1") {
    await adminDb.from("groups").delete().eq("id", groupId);
    return c.redirect("/admin/groups");
  }

  const name = ((body.group_name as string) ?? "").trim();
  if (!name) return c.text("Group name is required", 400);

  // Moderator resolution. Three states:
  //   - "Clear moderator" checked → null
  //   - username supplied → look up → fail if not found
  //   - username empty + checkbox off → keep current
  const updates: Record<string, any> = {
    group_name: name,
    group_description: ((body.group_description as string) ?? "").trim(),
  };
  const groupType = parseInt(body.group_type as string, 10);
  if ([0, 1, 2].includes(groupType)) updates.group_type = groupType;

  if (body.delete_old_moderator === "1") {
    updates.group_moderator = null;
  } else {
    const modUsername = ((body.username as string) ?? "").trim();
    if (modUsername) {
      const { data: profile } = await adminDb
        .from("profiles")
        .select("id")
        .eq("username", modUsername)
        .maybeSingle();
      if (!profile) return c.text(`User '${modUsername}' not found`, 400);
      updates.group_moderator = (profile as any).id;
    }
  }

  await adminDb.from("groups").update(updates).eq("id", groupId);
  return c.redirect(`/admin/groups/${groupId}/edit`);
});

admin.get("/admin/groups/:id/members", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const groupId = parseInt(c.req.param("id"), 10);
  const adminDb = getSupabaseAdmin();

  const { data: group } = await adminDb
    .from("groups")
    .select("id, group_name")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) return c.text("Group not found", 404);

  const { data: rows } = await adminDb
    .from("user_group")
    .select("user_pending, profiles!user_group_user_id_fkey(id, username)")
    .eq("group_id", groupId);

  const active = (rows ?? [])
    .filter((r: any) => !r.user_pending)
    .map((r: any) => r.profiles)
    .filter(Boolean)
    .sort((a: any, b: any) => a.username.localeCompare(b.username));
  const pending = (rows ?? [])
    .filter((r: any) => r.user_pending)
    .map((r: any) => r.profiles)
    .filter(Boolean)
    .sort((a: any, b: any) => a.username.localeCompare(b.username));

  const memberRow = (p: any, kind: "active" | "pending", i: number) => {
    const cls = i % 2 === 0 ? "row1" : "row2";
    return (
      `<tr>` +
        `<td class="${cls}"><a href="/profile/${encodeURIComponent(p.id)}">${escapeHtml(p.username)}</a></td>` +
        `<td class="${cls}" align="center">` +
          `<form method="post" action="/admin/groups/${groupId}/members" style="display:inline">` +
            formHiddenFields(c).html +
            `<input type="hidden" name="user_id" value="${p.id}" />` +
            (kind === "pending"
              ? `<button type="submit" name="action" value="approve">Approve</button> ` +
                `<button type="submit" name="action" value="remove">Reject</button>`
              : `<button type="submit" name="action" value="remove">Remove</button>`) +
          `</form>` +
        `</td>` +
      `</tr>`
    );
  };

  const activeRows = active.length
    ? active.map((p, i) => memberRow(p, "active", i)).join("")
    : `<tr><td class="row1" colspan="2" align="center">No members.</td></tr>`;
  const pendingRows = pending.length
    ? pending.map((p, i) => memberRow(p, "pending", i)).join("")
    : `<tr><td class="row1" colspan="2" align="center">No pending requests.</td></tr>`;

  const body =
    `<h1>Members of "${escapeHtml((group as any).group_name)}"</h1>` +
    `<p><a href="/admin/groups">&larr; Back to groups</a> &middot; ` +
    `<a href="/admin/groups/${groupId}/edit">Edit this group</a> &middot; ` +
    `<a href="/admin/auth/group/${groupId}">Permissions</a></p>` +
    `<table cellspacing="1" cellpadding="4" border="0" align="center" class="forumline" width="100%">` +
      `<tr><th class="thHead" colspan="2">Active members</th></tr>` +
      activeRows +
      `<tr><th class="thHead" colspan="2">Pending requests</th></tr>` +
      pendingRows +
    `</table>` +
    `<h2>Add member</h2>` +
    `<form method="post" action="/admin/groups/${groupId}/members">` +
      formHiddenFields(c).html +
      `<input type="hidden" name="action" value="add" />` +
      `<label>Username: <input type="text" name="username" /></label> ` +
      `<button type="submit">Add</button>` +
    `</form>`;

  return c.html(
    renderAdminPage({
      title: `Plank Forum :: Members of ${(group as any).group_name}`,
      body,
      currentUrl: new URL(c.req.url).pathname,
    })
  );
});

admin.post("/admin/groups/:id/members", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const groupId = parseInt(c.req.param("id"), 10);
  const body = await c.req.parseBody();
  const action = body.action as string;
  const adminDb = getSupabaseAdmin();

  if (action === "add") {
    const username = ((body.username as string) ?? "").trim();
    if (!username) return c.redirect(`/admin/groups/${groupId}/members`);
    const { data: profile } = await adminDb
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (!profile) return c.text(`User '${username}' not found`, 400);
    // upsert handles "already a member" cleanly; we always promote to
    // non-pending so admin adds bypass any approval flow.
    await adminDb.from("user_group").upsert(
      {
        group_id: groupId,
        user_id: (profile as any).id,
        user_pending: false,
      },
      { onConflict: "group_id,user_id" }
    );
    return c.redirect(`/admin/groups/${groupId}/members`);
  }

  const targetUserId = (body.user_id as string) ?? "";
  if (!targetUserId) return c.redirect(`/admin/groups/${groupId}/members`);

  if (action === "remove") {
    await adminDb
      .from("user_group")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", targetUserId);
  } else if (action === "approve") {
    await adminDb
      .from("user_group")
      .update({ user_pending: false })
      .eq("group_id", groupId)
      .eq("user_id", targetUserId);
  }
  return c.redirect(`/admin/groups/${groupId}/members`);
});


export default admin;
