import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { createClient } from "@supabase/supabase-js";
import { createPageTemplate, renderPage } from "../lib/render.js";

const auth = new Hono();

// ─── Login Page ────────────────────────────────────────────────

auth.get("/login", (c) => {
  const user = c.get("user");
  if (user) return c.redirect("/");

  const tpl = createPageTemplate({ pageTitle: "Log in" });
  tpl.loadFile("body", "login_body.tpl");

  tpl.assignVars({
    S_LOGIN_ACTION: "/login",
    L_ENTER_PASSWORD: "Log in",
    L_INDEX: "Index",
    U_INDEX: "/",
    L_USERNAME: "Username",
    L_PASSWORD: "Password",
    L_AUTO_LOGIN: "Log me on automatically each visit",
    L_LOGIN: "Log in",
    L_SEND_PASSWORD: "I forgot my password",
    U_SEND_PASSWORD: "/forgot-password",
    USERNAME: "",
    S_HIDDEN_FIELDS: "",
  });
  tpl.assignBlockVars("switch_allow_autologin", {});

  return c.html(renderPage(tpl));
});

auth.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const username = body.username as string;
  const password = body.password as string;

  if (!username || !password) {
    return c.redirect("/login");
  }

  // Look up the user's email by username
  const adminSupabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .single();

  if (!profile) {
    // User not found — render login with error
    const tpl = createPageTemplate({ pageTitle: "Log in" });
    tpl.loadFile("body", "login_body.tpl");
    tpl.assignVars({
      S_LOGIN_ACTION: "/login",
      L_ENTER_PASSWORD: "Login failed. Please check your username and password.",
      L_INDEX: "Index",
      U_INDEX: "/",
      L_USERNAME: "Username",
      L_PASSWORD: "Password",
      L_AUTO_LOGIN: "Log me on automatically each visit",
      L_LOGIN: "Log in",
      L_SEND_PASSWORD: "I forgot my password",
      U_SEND_PASSWORD: "/forgot-password",
      USERNAME: username,
      S_HIDDEN_FIELDS: "",
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
      L_ENTER_PASSWORD: "Login failed. Please check your username and password.",
      L_INDEX: "Index",
      U_INDEX: "/",
      L_USERNAME: "Username",
      L_PASSWORD: "Password",
      L_AUTO_LOGIN: "Log me on automatically each visit",
      L_LOGIN: "Log in",
      L_SEND_PASSWORD: "I forgot my password",
      U_SEND_PASSWORD: "/forgot-password",
      USERNAME: username,
      S_HIDDEN_FIELDS: "",
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

  return c.redirect("/");
});

// ─── Register Page ─────────────────────────────────────────────

auth.get("/register", (c) => {
  const user = c.get("user");
  if (user) return c.redirect("/");

  return c.html(renderRegisterPage());
});

auth.post("/register", async (c) => {
  const body = await c.req.parseBody();
  const username = (body.username as string)?.trim();
  const email = (body.email as string)?.trim();
  const password = body.new_password as string;
  const passwordConfirm = body.password_confirm as string;

  // Validation
  if (!username || !email || !password) {
    return c.html(renderRegisterPage("All fields marked with * are required.", { username, email }));
  }
  if (password !== passwordConfirm) {
    return c.html(renderRegisterPage("Passwords do not match.", { username, email }));
  }
  if (username.length < 3 || username.length > 25) {
    return c.html(renderRegisterPage("Username must be between 3 and 25 characters.", { username, email }));
  }

  const adminSupabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Check if username is taken
  const { data: existing } = await adminSupabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .single();

  if (existing) {
    return c.html(renderRegisterPage("This username is already taken.", { username, email }));
  }

  // Create auth user
  const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError) {
    return c.html(renderRegisterPage(`Registration failed: ${authError.message}`, { username, email }));
  }

  // Create profile
  const { error: profileError } = await adminSupabase.from("profiles").insert({
    id: authData.user.id,
    username,
  });

  if (profileError) {
    // Rollback: delete the auth user
    await adminSupabase.auth.admin.deleteUser(authData.user.id);
    return c.html(renderRegisterPage(`Registration failed: ${profileError.message}`, { username, email }));
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
  error?: string,
  values?: { username?: string; email?: string }
): string {
  const tpl = createPageTemplate({ pageTitle: "Register" });
  tpl.loadFile("body", "profile_add_body.tpl");

  tpl.assignVars({
    S_PROFILE_ACTION: "/register",
    S_FORM_ENCTYPE: "",
    ERROR_BOX: error
      ? `<table class="forumline" width="100%" cellspacing="1" cellpadding="4" border="0"><tr><td class="row1"><span class="genmed" style="color:red">${error}</span></td></tr></table><br />`
      : "",
    L_INDEX: "Index",
    U_INDEX: "/",
    L_REGISTRATION_INFO: "Registration Information",
    L_ITEMS_REQUIRED: "Items marked with a * are required.",
    L_USERNAME: "Username",
    L_EMAIL_ADDRESS: "E-mail address",
    L_NEW_PASSWORD: "Password",
    L_PASSWORD_IF_CHANGED: "",
    L_CONFIRM_PASSWORD: "Confirm password",
    L_PASSWORD_CONFIRM_IF_CHANGED: "",
    L_PROFILE_INFO: "Profile Information",
    L_PROFILE_INFO_NOTICE: "This information is optional.",
    L_ICQ_NUMBER: "ICQ Number",
    L_AIM: "AIM Address",
    L_MESSENGER: "MSN Messenger",
    L_YAHOO: "Yahoo Messenger",
    L_WEBSITE: "Website",
    L_LOCATION: "Location",
    L_OCCUPATION: "Occupation",
    L_INTERESTS: "Interests",
    L_SIGNATURE: "Signature",
    L_SIGNATURE_EXPLAIN: "This is a block of text that can be added to posts you make.",
    L_PREFERENCES: "Preferences",
    L_PUBLIC_VIEW_EMAIL: "Make my email public",
    L_HIDE_USER: "Hide your online status",
    L_NOTIFY_ON_REPLY: "Notify on reply",
    L_NOTIFY_ON_REPLY_EXPLAIN: "Sends an email when someone replies to a topic you have posted in.",
    L_NOTIFY_ON_PRIVMSG: "Notify on new PM",
    L_POPUP_ON_PRIVMSG: "Popup on new PM",
    L_POPUP_ON_PRIVMSG_EXPLAIN: "If your board has popup enabled.",
    L_ALWAYS_ADD_SIGNATURE: "Always attach my signature",
    L_ALWAYS_ALLOW_BBCODE: "Always allow BBCode",
    L_ALWAYS_ALLOW_HTML: "Always allow HTML",
    L_ALWAYS_ALLOW_SMILIES: "Always enable Smilies",
    L_BOARD_LANGUAGE: "Board Language",
    L_BOARD_STYLE: "Board Style",
    L_TIMEZONE: "Timezone",
    L_DATE_FORMAT: "Date Format",
    L_DATE_FORMAT_EXPLAIN: "",
    L_CURRENT_PASSWORD: "Current Password",
    L_CONFIRM_PASSWORD_EXPLAIN: "You must confirm your current password to change it.",
    L_CONFIRM_CODE: "Confirmation code",
    L_CONFIRM_CODE_EXPLAIN: "Enter the code shown above.",
    L_CONFIRM_CODE_IMPAIRED: "",
    L_YES: "Yes",
    L_NO: "No",
    L_SUBMIT: "Submit",
    L_RESET: "Reset",
    L_AVATAR_PANEL: "Avatar",
    L_AVATAR_EXPLAIN: "You may display a small image below your details in posts.",
    L_CURRENT_IMAGE: "Current image",
    L_DELETE_AVATAR: "Delete avatar",
    L_UPLOAD_AVATAR_FILE: "Upload from your machine",
    L_UPLOAD_AVATAR_URL: "Upload from a URL",
    L_UPLOAD_AVATAR_URL_EXPLAIN: "",
    L_LINK_REMOTE_AVATAR: "Link to off-site avatar",
    L_LINK_REMOTE_AVATAR_EXPLAIN: "",
    L_AVATAR_GALLERY: "Avatar Gallery",
    L_SHOW_GALLERY: "Show Gallery",
    HTML_STATUS: "",
    BBCODE_STATUS: "BBCode is ON",
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
    AVATAR_SIZE: "6144",
    LANGUAGE_SELECT: '<option value="english" selected>English</option>',
    STYLE_SELECT: '<option value="Solaris" selected>Solaris</option>',
    TIMEZONE_SELECT: '<option value="0" selected>UTC</option>',
    DATE_FORMAT: "D M d, Y g:i a",
    VIEW_EMAIL_YES: "",
    VIEW_EMAIL_NO: 'checked="checked"',
    HIDE_USER_YES: "",
    HIDE_USER_NO: 'checked="checked"',
    NOTIFY_REPLY_YES: 'checked="checked"',
    NOTIFY_REPLY_NO: "",
    NOTIFY_PM_YES: 'checked="checked"',
    NOTIFY_PM_NO: "",
    POPUP_PM_YES: "",
    POPUP_PM_NO: 'checked="checked"',
    ALWAYS_ADD_SIGNATURE_YES: 'checked="checked"',
    ALWAYS_ADD_SIGNATURE_NO: "",
    ALWAYS_ALLOW_BBCODE_YES: 'checked="checked"',
    ALWAYS_ALLOW_BBCODE_NO: "",
    ALWAYS_ALLOW_HTML_YES: "",
    ALWAYS_ALLOW_HTML_NO: 'checked="checked"',
    ALWAYS_ALLOW_SMILIES_YES: 'checked="checked"',
    ALWAYS_ALLOW_SMILIES_NO: "",
    S_HIDDEN_FIELDS: "",
    CONFIRM_IMG: "",
  });

  return renderPage(tpl);
}

export default auth;
