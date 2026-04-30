import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { createPageTemplate, renderPage, renderErrorBox } from "../lib/render.js";
import { getAvatarConfig, getSupabaseAdmin, type AvatarConfig } from "../db/client.js";
import { escapeHtml } from "../lib/escape.js";
import { markup } from "../lib/markup.js";
import { formHiddenFields } from "../lib/csrf.js";
import type { Context } from "hono";

const auth = new Hono();

/** Build a /login URL that redirects back to the given request's current page after login. */
export function loginRedirect(c: { req: { url: string } }): string {
  const url = new URL(c.req.url);
  const path = url.pathname + url.search;
  return `/login?redirect=${encodeURIComponent(path)}`;
}

// ─── Login Page ────────────────────────────────────────────────

auth.get("/login", (c) => {
  const user = c.get("user");
  if (user) return c.redirect("/");

  const redirect = c.req.query("redirect") ?? "";

  const tpl = createPageTemplate({ pageTitle: "Log in" });
  tpl.loadFile("body", "login_body.tpl");

  tpl.assignVars({
    S_LOGIN_ACTION: "/login",
    L_ENTER_PASSWORD: "Please enter your username and password to log in.",
    L_INDEX: "Index",
    U_INDEX: "/",
    L_USERNAME: "Username",
    L_PASSWORD: "Password",
    L_AUTO_LOGIN: "Log me on automatically each visit",
    L_LOGIN: "Log in",
    L_SEND_PASSWORD: "I forgot my password",
    U_SEND_PASSWORD: "/forgot-password",
    USERNAME: "",
    S_HIDDEN_FIELDS: formHiddenFields(
      c,
      redirect ? `<input type="hidden" name="redirect" value="${escapeHtml(redirect)}" />` : ""
    ),
  });
  tpl.assignBlockVars("switch_allow_autologin", {});

  return c.html(renderPage(tpl));
});

auth.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const username = body.username as string;
  const password = body.password as string;
  const redirect = (body.redirect as string) ?? "";

  // Validate redirect is a local path to prevent open redirects
  const safeRedirect = redirect && redirect.startsWith("/") && !redirect.startsWith("//")
    ? redirect
    : "/";

  if (!username || !password) {
    return c.redirect(redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : "/login");
  }

  // Look up the user's email by username
  const adminSupabase = getSupabaseAdmin();

  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (!profile) {
    // User not found — render login with error
    const tpl = createPageTemplate({ pageTitle: "Log in" });
    tpl.loadFile("body", "login_body.tpl");
    tpl.assignVars({
      S_LOGIN_ACTION: "/login",
      L_ENTER_PASSWORD: "You have specified an incorrect or inactive username, or an invalid password.",
      L_INDEX: "Index",
      U_INDEX: "/",
      L_USERNAME: "Username",
      L_PASSWORD: "Password",
      L_AUTO_LOGIN: "Log me on automatically each visit",
      L_LOGIN: "Log in",
      L_SEND_PASSWORD: "I forgot my password",
      U_SEND_PASSWORD: "/forgot-password",
      USERNAME: username,
      S_HIDDEN_FIELDS: formHiddenFields(
        c,
        redirect ? `<input type="hidden" name="redirect" value="${escapeHtml(redirect)}" />` : ""
      ),
    });
    tpl.assignBlockVars("switch_allow_autologin", {});
    return c.html(renderPage(tpl));
  }

  // Get the user's email from auth.users
  const { data: authUser } = await adminSupabase.auth.admin.getUserById(
    profile.id
  );

  if (!authUser?.user?.email) {
    return c.redirect("/login");
  }

  // Attempt sign in with email + password
  const supabase = c.get("supabase");
  const { data: session, error } = await supabase.auth.signInWithPassword({
    email: authUser.user.email,
    password,
  });

  if (error || !session.session) {
    const tpl = createPageTemplate({ pageTitle: "Log in" });
    tpl.loadFile("body", "login_body.tpl");
    tpl.assignVars({
      S_LOGIN_ACTION: "/login",
      L_ENTER_PASSWORD: "You have specified an incorrect or inactive username, or an invalid password.",
      L_INDEX: "Index",
      U_INDEX: "/",
      L_USERNAME: "Username",
      L_PASSWORD: "Password",
      L_AUTO_LOGIN: "Log me on automatically each visit",
      L_LOGIN: "Log in",
      L_SEND_PASSWORD: "I forgot my password",
      U_SEND_PASSWORD: "/forgot-password",
      USERNAME: username,
      S_HIDDEN_FIELDS: formHiddenFields(
        c,
        redirect ? `<input type="hidden" name="redirect" value="${escapeHtml(redirect)}" />` : ""
      ),
    });
    tpl.assignBlockVars("switch_allow_autologin", {});
    return c.html(renderPage(tpl));
  }

  // Set session cookies
  setCookie(c, "sb-access-token", session.session.access_token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  setCookie(c, "sb-refresh-token", session.session.refresh_token!, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return c.redirect(safeRedirect);
});

// ─── Register Page ─────────────────────────────────────────────

auth.get("/register", async (c) => {
  const user = c.get("user");
  if (user) return c.redirect("/");

  const supabase = c.get("supabase");
  const avatarConfig = await getAvatarConfig(supabase);
  return c.html(renderRegisterPage(c, undefined, undefined, avatarConfig));
});

auth.post("/register", async (c) => {
  const body = await c.req.parseBody();
  const username = (body.username as string)?.trim();
  const email = (body.email as string)?.trim();
  const password = body.new_password as string;
  const passwordConfirm = body.password_confirm as string;

  const supabaseForConfig = c.get("supabase");
  const avatarConfig = await getAvatarConfig(supabaseForConfig);

  // Validation
  if (!username || !email || !password) {
    return c.html(renderRegisterPage(c, "All fields marked with * are required.", { username, email }, avatarConfig));
  }
  if (password !== passwordConfirm) {
    return c.html(renderRegisterPage(c, "Passwords do not match.", { username, email }, avatarConfig));
  }
  if (username.length < 3 || username.length > 25) {
    return c.html(renderRegisterPage(c, "Username must be between 3 and 25 characters.", { username, email }, avatarConfig));
  }

  const adminSupabase = getSupabaseAdmin();

  // Check if username is taken
  const { data: existing } = await adminSupabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (existing) {
    return c.html(renderRegisterPage(c, "This username is already taken.", { username, email }, avatarConfig));
  }

  // Create auth user
  const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError) {
    return c.html(renderRegisterPage(c, `Registration failed: ${authError.message}`, { username, email }, avatarConfig));
  }

  // Create profile
  const { error: profileError } = await adminSupabase.from("profiles").insert({
    id: authData.user.id,
    username,
  });

  if (profileError) {
    // Rollback: delete the auth user
    await adminSupabase.auth.admin.deleteUser(authData.user.id);
    return c.html(renderRegisterPage(c, `Registration failed: ${profileError.message}`, { username, email }, avatarConfig));
  }

  // Auto sign in
  const supabase = c.get("supabase");
  const { data: session } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (session?.session) {
    setCookie(c, "sb-access-token", session.session.access_token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    setCookie(c, "sb-refresh-token", session.session.refresh_token!, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return c.redirect("/");
});

// ─── Logout ────────────────────────────────────────────────────

auth.get("/logout", async (c) => {
  const supabase = c.get("supabase");
  await supabase.auth.signOut();
  deleteCookie(c, "sb-access-token", { path: "/" });
  deleteCookie(c, "sb-refresh-token", { path: "/" });
  return c.redirect("/");
});

// ─── Helpers ───────────────────────────────────────────────────

function renderRegisterPage(
  c: Context,
  error?: string,
  values?: { username?: string; email?: string },
  avatarConfig?: AvatarConfig
): string {
  const maxW = avatarConfig?.maxWidth ?? 200;
  const maxH = avatarConfig?.maxHeight ?? 200;
  const maxFilesize = avatarConfig?.maxFilesize ?? 6291456;

  const tpl = createPageTemplate({ pageTitle: "Register" });
  tpl.loadFile("body", "profile_add_body.tpl");

  tpl.assignVars({
    S_PROFILE_ACTION: "/register",
    S_FORM_ENCTYPE: "",
    ERROR_BOX: error ? renderErrorBox(error) : markup(""),
    L_INDEX: "Index",
    U_INDEX: "/",
    L_REGISTRATION_INFO: "Registration Information",
    L_ITEMS_REQUIRED: "Items marked with a * are required unless stated otherwise.",
    L_USERNAME: "Username",
    L_EMAIL_ADDRESS: "E-mail address",
    L_NEW_PASSWORD: "New password",
    L_PASSWORD_IF_CHANGED: "You only need to supply a password if you want to change it",
    L_CONFIRM_PASSWORD: "Confirm password",
    L_PASSWORD_CONFIRM_IF_CHANGED: "You only need to confirm your password if you changed it above",
    L_PROFILE_INFO: "Profile Information",
    L_PROFILE_INFO_NOTICE: "This information will be publicly viewable",
    L_ICQ_NUMBER: "ICQ Number",
    L_AIM: "AIM Address",
    L_MESSENGER: "MSN Messenger",
    L_YAHOO: "Yahoo Messenger",
    L_WEBSITE: "Website",
    L_LOCATION: "Location",
    L_OCCUPATION: "Occupation",
    L_INTERESTS: "Interests",
    L_SIGNATURE: "Signature",
    L_SIGNATURE_EXPLAIN: "This is a block of text that can be added to posts you make",
    L_PREFERENCES: "Preferences",
    L_PUBLIC_VIEW_EMAIL: "Always show my e-mail address",
    L_HIDE_USER: "Hide your online status",
    L_NOTIFY_ON_REPLY: "Always notify me of replies",
    L_NOTIFY_ON_REPLY_EXPLAIN: "Sends an e-mail when someone replies to a topic you have posted in. This can be changed whenever you post.",
    L_NOTIFY_ON_PRIVMSG: "Notify on new Private Message",
    L_POPUP_ON_PRIVMSG: "Pop up window on new Private Message",
    L_POPUP_ON_PRIVMSG_EXPLAIN: "Some templates may open a new window to inform you when new private messages arrive.",
    L_ALWAYS_ADD_SIGNATURE: "Always attach my signature",
    L_ALWAYS_ALLOW_BBCODE: "Always allow BBCode",
    L_ALWAYS_ALLOW_HTML: "Always allow HTML",
    L_ALWAYS_ALLOW_SMILIES: "Always enable Smilies",
    L_BOARD_LANGUAGE: "Board Language",
    L_BOARD_STYLE: "Board Style",
    L_TIMEZONE: "Timezone",
    L_DATE_FORMAT: "Date Format",
    L_DATE_FORMAT_EXPLAIN: markup('The syntax used is identical to the PHP <a href="https://www.php.net/date" target="_other">date()</a> function.'),
    L_CURRENT_PASSWORD: "Current Password",
    L_CONFIRM_PASSWORD_EXPLAIN: "You must confirm your current password if you wish to change it or alter your e-mail address",
    L_CONFIRM_CODE: "Confirmation code",
    L_CONFIRM_CODE_EXPLAIN: "Enter the code shown above.",
    L_CONFIRM_CODE_IMPAIRED: "",
    L_YES: "Yes",
    L_NO: "No",
    L_SUBMIT: "Submit",
    L_RESET: "Reset",
    L_AVATAR_PANEL: "Avatar control panel",
    L_AVATAR_EXPLAIN: `Displays a small graphic image below your details in posts. Only one image can be displayed at a time, its width can be no greater than ${maxW} pixels, the height no greater than ${maxH} pixels, and the file size no more than ${maxFilesize} bytes.`,
    L_CURRENT_IMAGE: "Current Image",
    L_DELETE_AVATAR: "Delete Image",
    L_UPLOAD_AVATAR_FILE: "Upload Avatar from your machine",
    L_UPLOAD_AVATAR_URL: "Upload Avatar from a URL",
    L_UPLOAD_AVATAR_URL_EXPLAIN: "",
    L_LINK_REMOTE_AVATAR: "Link to off-site Avatar",
    L_LINK_REMOTE_AVATAR_EXPLAIN: "",
    L_AVATAR_GALLERY: "Avatar gallery",
    L_SHOW_GALLERY: "Show gallery",
    HTML_STATUS: "",
    BBCODE_STATUS: markup('<a href="/faq" target="_phpbbcode">BBCode</a> is <u>ON</u>'),
    SMILIES_STATUS: "Smilies are ON",

    // Prefill values
    USERNAME: values?.username ?? "",
    EMAIL: values?.email ?? "",
    NEW_PASSWORD: "",
    PASSWORD_CONFIRM: "",
    CUR_PASSWORD: "",
    ICQ: "",
    AIM: "",
    MSN: "",
    YIM: "",
    WEBSITE: "",
    LOCATION: "",
    OCCUPATION: "",
    INTERESTS: "",
    SIGNATURE: "",
    AVATAR: "",
    AVATAR_SIZE: String(maxFilesize),
    LANGUAGE_SELECT: markup('<option value="english" selected>English</option>'),
    STYLE_SELECT: markup('<option value="Solaris" selected>Solaris</option>'),
    TIMEZONE_SELECT: markup('<option value="0" selected>UTC</option>'),
    DATE_FORMAT: "D M d, Y g:i a",
    VIEW_EMAIL_YES: "",
    VIEW_EMAIL_NO: markup('checked="checked"'),
    HIDE_USER_YES: "",
    HIDE_USER_NO: markup('checked="checked"'),
    NOTIFY_REPLY_YES: markup('checked="checked"'),
    NOTIFY_REPLY_NO: "",
    NOTIFY_PM_YES: markup('checked="checked"'),
    NOTIFY_PM_NO: "",
    POPUP_PM_YES: "",
    POPUP_PM_NO: markup('checked="checked"'),
    ALWAYS_ADD_SIGNATURE_YES: markup('checked="checked"'),
    ALWAYS_ADD_SIGNATURE_NO: "",
    ALWAYS_ALLOW_BBCODE_YES: markup('checked="checked"'),
    ALWAYS_ALLOW_BBCODE_NO: "",
    ALWAYS_ALLOW_HTML_YES: "",
    ALWAYS_ALLOW_HTML_NO: markup('checked="checked"'),
    ALWAYS_ALLOW_SMILIES_YES: markup('checked="checked"'),
    ALWAYS_ALLOW_SMILIES_NO: "",
    S_HIDDEN_FIELDS: formHiddenFields(c),
    CONFIRM_IMG: "",
  });

  return renderPage(tpl);
}

export default auth;
