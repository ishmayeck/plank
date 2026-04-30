import { Hono } from "hono";
import { Template } from "../template/engine.js";
import { getSupabaseAdmin } from "../db/client.js";
import { escapeHtml } from "../lib/escape.js";
import { USER_LEVEL, isAdmin } from "../lib/userLevel.js";
import path from "path";

const THEME_DIR = path.join(process.cwd(), "themes", "Solaris");

const admin = new Hono();

function adminRender(bodyTpl: string): Template {
  const tpl = new Template(THEME_DIR);
  tpl.loadFile("header", "admin/page_header.tpl");
  tpl.loadFile("body", `admin/${bodyTpl}`);
  tpl.loadFile("footer", "admin/page_footer.tpl");
  tpl.assignVars({
    META: "",
    S_CONTENT_ENCODING: "utf-8",
    SITENAME: "Plank Forum",
    L_PHPBB_ADMIN: "Administration Panel",
    PHPBB_VERSION: "Plank 1.0",
    TRANSLATION_INFO: "",
  });
  return tpl;
}

function renderAdmin(tpl: Template): string {
  return tpl.render("header") + tpl.render("body") + tpl.render("footer");
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

  return c.html(renderAdmin(tpl));
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
    S_HIDDEN_FIELDS: "",

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
    S_DISABLE_BOARD_YES: cfg.board_disable === "1" ? 'checked="checked"' : "",
    S_DISABLE_BOARD_NO: cfg.board_disable !== "1" ? 'checked="checked"' : "",
    ACTIVATION_NONE: "0",
    ACTIVATION_USER: "1",
    ACTIVATION_ADMIN: "2",
    ACTIVATION_NONE_CHECKED: (cfg.require_activation ?? "0") === "0" ? 'checked="checked"' : "",
    ACTIVATION_USER_CHECKED: cfg.require_activation === "1" ? 'checked="checked"' : "",
    ACTIVATION_ADMIN_CHECKED: cfg.require_activation === "2" ? 'checked="checked"' : "",
    CONFIRM_ENABLE: (cfg.enable_confirm ?? "1") === "1" ? 'checked="checked"' : "",
    CONFIRM_DISABLE: cfg.enable_confirm === "0" ? 'checked="checked"' : "",
    ALLOW_AUTOLOGIN_YES: (cfg.allow_autologin ?? "1") === "1" ? 'checked="checked"' : "",
    ALLOW_AUTOLOGIN_NO: cfg.allow_autologin === "0" ? 'checked="checked"' : "",
    AUTOLOGIN_TIME: cfg.max_autologin_time ?? "30",
    BOARD_EMAIL_FORM_ENABLE: (cfg.board_email_form ?? "1") === "1" ? 'checked="checked"' : "",
    BOARD_EMAIL_FORM_DISABLE: cfg.board_email_form === "0" ? 'checked="checked"' : "",
    FLOOD_INTERVAL: cfg.flood_interval ?? "15",
    SEARCH_FLOOD_INTERVAL: cfg.search_flood_interval ?? "15",
    MAX_LOGIN_ATTEMPTS: cfg.max_login_attempts ?? "5",
    LOGIN_RESET_TIME: cfg.login_reset_time ?? "30",
    TOPICS_PER_PAGE: cfg.topics_per_page ?? "25",
    POSTS_PER_PAGE: cfg.posts_per_page ?? "15",
    HOT_TOPIC: cfg.hot_threshold ?? "25",
    STYLE_SELECT: '<select name="default_style"><option value="Solaris" selected>Solaris</option></select>',
    OVERRIDE_STYLE_YES: cfg.override_user_style === "1" ? 'checked="checked"' : "",
    OVERRIDE_STYLE_NO: (cfg.override_user_style ?? "0") !== "1" ? 'checked="checked"' : "",
    LANG_SELECT: '<select name="default_lang"><option value="english" selected>English</option></select>',
    DEFAULT_DATEFORMAT: cfg.default_dateformat ?? "D M d, Y g:i a",
    TIMEZONE_SELECT: '<select name="board_timezone"><option value="0" selected>UTC</option></select>',
    GZIP_YES: cfg.gzip_compress === "1" ? 'checked="checked"' : "",
    GZIP_NO: (cfg.gzip_compress ?? "0") !== "1" ? 'checked="checked"' : "",
    PRUNE_YES: cfg.prune_enable === "1" ? 'checked="checked"' : "",
    PRUNE_NO: (cfg.prune_enable ?? "0") !== "1" ? 'checked="checked"' : "",

    // Cookie
    COOKIE_DOMAIN: cfg.cookie_domain ?? "",
    COOKIE_NAME: cfg.cookie_name ?? "plank",
    COOKIE_PATH: cfg.cookie_path ?? "/",
    S_COOKIE_SECURE_ENABLED: cfg.cookie_secure === "1" ? 'checked="checked"' : "",
    S_COOKIE_SECURE_DISABLED: (cfg.cookie_secure ?? "0") !== "1" ? 'checked="checked"' : "",
    SESSION_LENGTH: cfg.session_length ?? "3600",

    // PM
    S_PRIVMSG_ENABLED: (cfg.privmsg_disable ?? "0") === "0" ? 'checked="checked"' : "",
    S_PRIVMSG_DISABLED: cfg.privmsg_disable === "1" ? 'checked="checked"' : "",
    INBOX_LIMIT: cfg.max_inbox_privmsgs ?? "50",
    SENTBOX_LIMIT: cfg.max_sentbox_privmsgs ?? "25",
    SAVEBOX_LIMIT: cfg.max_savebox_privmsgs ?? "50",

    // Abilities
    MAX_POLL_OPTIONS: cfg.max_poll_options ?? "10",
    HTML_YES: cfg.allow_html === "1" ? 'checked="checked"' : "",
    HTML_NO: (cfg.allow_html ?? "0") !== "1" ? 'checked="checked"' : "",
    HTML_TAGS: cfg.allow_html_tags ?? "",
    BBCODE_YES: (cfg.allow_bbcode ?? "1") === "1" ? 'checked="checked"' : "",
    BBCODE_NO: cfg.allow_bbcode === "0" ? 'checked="checked"' : "",
    SMILE_YES: (cfg.allow_smilies ?? "1") === "1" ? 'checked="checked"' : "",
    SMILE_NO: cfg.allow_smilies === "0" ? 'checked="checked"' : "",
    SMILIES_PATH: cfg.smilies_path ?? "images/smilies",
    SIG_YES: (cfg.allow_sig ?? "1") === "1" ? 'checked="checked"' : "",
    SIG_NO: cfg.allow_sig === "0" ? 'checked="checked"' : "",
    SIG_SIZE: cfg.max_sig_chars ?? "255",
    NAMECHANGE_YES: cfg.allow_namechange === "1" ? 'checked="checked"' : "",
    NAMECHANGE_NO: (cfg.allow_namechange ?? "0") !== "1" ? 'checked="checked"' : "",

    // Avatars
    AVATARS_LOCAL_YES: (cfg.allow_avatar_local ?? "1") === "1" ? 'checked="checked"' : "",
    AVATARS_LOCAL_NO: cfg.allow_avatar_local === "0" ? 'checked="checked"' : "",
    AVATARS_REMOTE_YES: (cfg.allow_avatar_remote ?? "1") === "1" ? 'checked="checked"' : "",
    AVATARS_REMOTE_NO: cfg.allow_avatar_remote === "0" ? 'checked="checked"' : "",
    AVATARS_UPLOAD_YES: (cfg.allow_avatar_upload ?? "1") === "1" ? 'checked="checked"' : "",
    AVATARS_UPLOAD_NO: cfg.allow_avatar_upload === "0" ? 'checked="checked"' : "",
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
    SMTP_YES: cfg.smtp_delivery === "1" ? 'checked="checked"' : "",
    SMTP_NO: (cfg.smtp_delivery ?? "0") !== "1" ? 'checked="checked"' : "",
    SMTP_HOST: cfg.smtp_host ?? "",
    SMTP_USERNAME: cfg.smtp_username ?? "",
    SMTP_PASSWORD: cfg.smtp_password ?? "",
  });

  return c.html(renderAdmin(tpl));
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
        U_CAT_DELETE: `/admin/forums?mode=deletecat&c=${cat.id}`,
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
          U_FORUM_DELETE: `/admin/forums?mode=deleteforum&f=${forum.id}`,
          U_FORUM_MOVE_UP: `/admin/forums?mode=forum_order&f=${forum.id}&dir=up`,
          U_FORUM_MOVE_DOWN: `/admin/forums?mode=forum_order&f=${forum.id}&dir=down`,
          U_FORUM_RESYNC: `/admin/forums?mode=resync&f=${forum.id}`,
        });
      }
    }
  }

  return c.html(renderAdmin(tpl));
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
      .single();

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
          .single();

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

// Category/forum ordering and editing via GET actions

admin.get("/admin/forums", async (c) => {
  // This handler is already defined above, but we need to handle mode params
  // The main GET handler above will handle rendering. We handle actions here via a separate approach.
});

// Use a catch-all approach - handle action modes in a middleware-like pattern
admin.get("/admin/forum-action", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const mode = c.req.query("mode");
  const adminDb = getSupabaseAdmin();

  if (mode === "cat_order") {
    const catId = parseInt(c.req.query("c") ?? "0", 10);
    const dir = c.req.query("dir");
    if (!catId) return c.redirect("/admin/forums");

    const { data: cat } = await adminDb
      .from("categories")
      .select("cat_order")
      .eq("id", catId)
      .single();
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
      .single();
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
    .single();

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
      .single();

    if (!profile) return c.text("User not found", 404);

    // Return a simple edit form (not using full template for brevity)
    const tpl = adminRender("user_select_body.tpl");
    tpl.assignVars({
      L_USER_TITLE: `Edit User: ${profile.username}`,
      L_USER_EXPLAIN: "",
      L_USER_SELECT: "User",
      L_LOOK_UP: "Look up",
      L_FIND_USERNAME: "Find a username",
      S_USER_ACTION: "/admin/users",
      S_HIDDEN_FIELDS: "",
      U_SEARCH_USER: "/search",
    });
    // Override body with inline edit form
    const editHtml = `
      <h1>Edit User: ${escapeHtml(profile.username)}</h1>
      <form method="post" action="/admin/users">
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

    const header = tpl.render("header");
    const footer = tpl.render("footer");
    return c.html(header + editHtml + footer);
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
    S_HIDDEN_FIELDS: "",
    U_SEARCH_USER: "/search",
  });

  return c.html(renderAdmin(tpl));
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
        userUnbanSelect += `<option value="${ban.id}">${escapeHtml(String(username))} (${ban.ban_reason ?? "no reason"})</option>`;
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
    S_HIDDEN_FIELDS: "",
    U_SEARCH_USER: "/search",
    S_UNBAN_USERLIST_SELECT: userUnbanSelect,
    S_UNBAN_IPLIST_SELECT: ipUnbanSelect,
    S_UNBAN_EMAILLIST_SELECT: emailUnbanSelect,
  });

  return c.html(renderAdmin(tpl));
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
      .single();
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
        U_RANK_DELETE: `/admin/ranks?mode=delete&id=${rank.id}`,
      });
      rowIndex++;
    }
  }

  return c.html(renderAdmin(tpl));
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
    S_HIDDEN_FIELDS: "",
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
        U_SMILEY_DELETE: `/admin/smilies?mode=delete&id=${smiley.id}`,
      });
      rowIndex++;
    }
  }

  return c.html(renderAdmin(tpl));
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
    S_HIDDEN_FIELDS: "",
  });

  if (words) {
    let rowIndex = 0;
    for (const word of words) {
      tpl.assignBlockVars("words", {
        ROW_CLASS: rowIndex % 2 === 0 ? "row1" : "row2",
        WORD: word.word,
        REPLACEMENT: word.replacement,
        U_WORD_EDIT: `/admin/words?mode=edit&id=${word.id}`,
        U_WORD_DELETE: `/admin/words?mode=delete&id=${word.id}`,
      });
      rowIndex++;
    }
  }

  return c.html(renderAdmin(tpl));
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
  }

  // Handle delete via query param
  if (body.delete_id) {
    await adminDb
      .from("word_censors")
      .delete()
      .eq("id", parseInt(body.delete_id as string, 10));
  }

  return c.redirect("/admin/words");
});

// Delete actions via GET for words, smilies, ranks
admin.get("/admin/word-action", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const mode = c.req.query("mode");
  const id = parseInt(c.req.query("id") ?? "0", 10);
  if (!id) return c.redirect("/admin/words");

  const adminDb = getSupabaseAdmin();
  if (mode === "delete") {
    await adminDb.from("word_censors").delete().eq("id", id);
  }
  return c.redirect("/admin/words");
});

admin.get("/admin/smiley-action", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const mode = c.req.query("mode");
  const id = parseInt(c.req.query("id") ?? "0", 10);
  if (!id) return c.redirect("/admin/smilies");

  const adminDb = getSupabaseAdmin();
  if (mode === "delete") {
    await adminDb.from("smilies").delete().eq("id", id);
  }
  return c.redirect("/admin/smilies");
});

admin.get("/admin/rank-action", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.text("Forbidden", 403);

  const mode = c.req.query("mode");
  const id = parseInt(c.req.query("id") ?? "0", 10);
  if (!id) return c.redirect("/admin/ranks");

  const adminDb = getSupabaseAdmin();
  if (mode === "delete") {
    await adminDb.from("ranks").delete().eq("id", id);
  }
  return c.redirect("/admin/ranks");
});


export default admin;
