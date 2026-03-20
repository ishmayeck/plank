import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { createPageTemplate, renderPage, formatPhpBBDate, renderErrorBox, renderMessagePage, fetchAndRenderJumpbox } from "../lib/render.js";
import { parseBBCode } from "../lib/bbcode.js";
import { generatePagination } from "../lib/pagination.js";
import { getAvatarConfig, type AvatarConfig } from "../db/client.js";
import { loginRedirect } from "./auth.js";

const MEMBERS_PER_PAGE = 25;

const profile = new Hono();

// ─── View Profile ─────────────────────────────────────────────

profile.get("/profile/:id", async (c) => {
  const userId = c.req.param("id");
  const user = c.get("user");
  const supabase = c.get("supabase");

  const { data: profileData } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (!profileData) {
    return c.text("User not found", 404);
  }

  // Load ranks
  const { data: ranks } = await supabase.from("ranks").select("*");

  const rank = getRank(
    profileData.user_posts ?? 0,
    profileData.user_rank ?? 0,
    ranks ?? []
  );

  // Calculate post stats
  const { count: totalPosts } = await supabase
    .from("posts")
    .select("*", { count: "exact", head: true });

  const postPercent =
    totalPosts && totalPosts > 0
      ? ((profileData.user_posts / totalPosts) * 100).toFixed(2)
      : "0";

  const regDate = new Date(profileData.user_regdate);
  const daysSinceJoin = Math.max(
    1,
    Math.floor((Date.now() - regDate.getTime()) / (1000 * 60 * 60 * 24))
  );
  const postsPerDay = (profileData.user_posts / daysSinceJoin).toFixed(2);

  const tpl = createPageTemplate({
    user: user
      ? { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel }
      : null,
    pageTitle: "Viewing profile",
  });

  tpl.loadFile("body", "profile_view_body.tpl");

  const avatarImg = profileData.user_avatar
    ? `<img src="${profileData.user_avatar}" alt="" />`
    : "";

  tpl.assignVars({
    U_INDEX: "/",
    L_INDEX: "Index",
    L_VIEWING_PROFILE: `Viewing profile :: ${profileData.username}`,
    L_AVATAR: "Avatar",
    L_ABOUT_USER: `All about ${profileData.username}`,
    USERNAME: profileData.username,
    AVATAR_IMG: avatarImg,
    POSTER_RANK: rank.title,

    L_JOINED: "Joined",
    JOINED: formatPhpBBDate(regDate, true),

    L_TOTAL_POSTS: "Total posts",
    POSTS: String(profileData.user_posts ?? 0),
    POST_PERCENT_STATS: `${postPercent}% of total`,
    POST_DAY_STATS: `${postsPerDay} posts per day`,
    U_SEARCH_USER: `/search?search_author=${encodeURIComponent(profileData.username)}`,
    L_SEARCH_USER_POSTS: `Find all posts by ${profileData.username}`,

    L_LOCATION: "Location",
    LOCATION: profileData.user_from ?? "",

    L_WEBSITE: "Website",
    WWW: profileData.user_website
      ? `<a href="${profileData.user_website}" target="_blank">${profileData.user_website}</a>`
      : "",

    L_OCCUPATION: "Occupation",
    OCCUPATION: profileData.user_occ ?? "",

    L_INTERESTS: "Interests",
    INTERESTS: profileData.user_interests ?? "",

    // Contact section
    L_CONTACT: `Contact ${profileData.username}`,
    L_EMAIL_ADDRESS: "E-mail address",
    EMAIL_IMG: profileData.user_viewemail
      ? `<a href="mailto:TODO">[email]</a>`
      : "[ Hidden ]",
    L_PM: "Send private message",
    PM_IMG: user
      ? `<a href="/privmsg?mode=post&u=${profileData.id}">Send PM</a>`
      : "",
    L_MESSENGER: "MSN Messenger",
    MSN: "",
    L_YAHOO: "Yahoo Messenger",
    YIM_IMG: "",
    L_AIM: "AIM Address",
    AIM_IMG: "",
    L_ICQ_NUMBER: "ICQ Number",
    ICQ_IMG: "",
    JUMPBOX: await fetchAndRenderJumpbox(supabase),
  });

  return c.html(renderPage(tpl));
});

// ─── Edit Own Profile ─────────────────────────────────────────

profile.get("/profile", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect(loginRedirect(c));
  const supabase = c.get("supabase");

  const { data: profileData } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profileData) return c.text("Profile not found", 404);

  const avatarConfig = await getAvatarConfig(supabase);
  return c.html(renderProfileEditForm({ user, profileData, avatarConfig }));
});

profile.post("/profile", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect(loginRedirect(c));

  const body = await c.req.parseBody();

  const adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Handle avatar upload
  let avatarUrl: string | null = null;
  let avatarError: string | null = null;
  const avatarFile = body.avatar as File | undefined;
  const avatarDel = body.avatardel === "on";
  const avatarConfig = await getAvatarConfig(adminDb);

  if (avatarDel) {
    avatarUrl = null;
  } else if (avatarFile && avatarFile.size > 0) {
    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/gif"];
    if (!allowedTypes.includes(avatarFile.type)) {
      avatarError = "The image file type is invalid. Allowed types: JPEG, PNG, GIF.";
    } else if (avatarFile.size > avatarConfig.maxFilesize) {
      avatarError = `The image file size exceeds the allowed limit of ${avatarConfig.maxFilesize} bytes.`;
    } else {
      // Upload to Supabase Storage
      const ext = avatarFile.name.split(".").pop() ?? "png";
      const path = `avatars/${user.id}.${ext}`;
      const { error: uploadErr } = await adminDb.storage
        .from("avatars")
        .upload(path, avatarFile, {
          upsert: true,
          contentType: avatarFile.type,
        });

      if (uploadErr) {
        avatarError = `Avatar upload failed: ${uploadErr.message}`;
      } else {
        const { data: urlData } = adminDb.storage
          .from("avatars")
          .getPublicUrl(path);
        avatarUrl = urlData.publicUrl;
      }
    }

    if (avatarError) {
      const { data: profileData } = await adminDb
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      return c.html(
        renderProfileEditForm({
          user,
          profileData: profileData!,
          error: avatarError,
          avatarConfig,
        })
      );
    }
  }

  // Build update object
  const updates: Record<string, any> = {
    user_from: (body.location as string) ?? "",
    user_website: (body.website as string) ?? "",
    user_occ: (body.occupation as string) ?? "",
    user_interests: (body.interests as string) ?? "",
    user_sig: (body.signature as string) ?? "",
    user_viewemail: body.viewemail === "1",
    user_allow_viewonline: body.hideonline !== "1",
    user_attachsig: body.attachsig === "1",
  };

  if (avatarUrl !== null || avatarDel) {
    updates.user_avatar = avatarUrl;
    updates.user_avatar_type = avatarUrl ? 1 : 0;
  }

  await adminDb.from("profiles").update(updates).eq("id", user.id);

  // Handle password change
  const newPassword = body.new_password as string;
  if (newPassword && newPassword.trim()) {
    const confirmPassword = body.password_confirm as string;
    if (newPassword !== confirmPassword) {
      // Re-render with error
      const { data: profileData } = await adminDb
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      const avatarConfig = await getAvatarConfig(adminDb);
      return c.html(
        renderProfileEditForm({
          user,
          profileData: profileData!,
          error: "Passwords do not match",
          avatarConfig,
        })
      );
    }
    const { error: pwError } = await adminDb.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });
    if (pwError) {
      const { data: profileData } = await adminDb
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      const avatarConfig = await getAvatarConfig(adminDb);
      return c.html(
        renderProfileEditForm({
          user,
          profileData: profileData!,
          error: `Password change failed: ${pwError.message}`,
          avatarConfig,
        })
      );
    }
  }

  return c.html(
    renderMessagePage({
      ctx: { user: { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel } },
      title: "Information",
      messageHtml:
        'Your profile has been updated<br /><br />' +
        'Click <a href="/">Here</a> to return to the Index',
      redirectUrl: "/",
    })
  );
});

// ─── Member List ──────────────────────────────────────────────

profile.get("/memberlist", async (c) => {
  const user = c.get("user");
  const supabase = c.get("supabase");
  const page = parseInt(c.req.query("page") ?? "1", 10);
  const sortBy = c.req.query("sort") ?? "username";
  const order = c.req.query("order") ?? "asc";

  const { count: totalMembers } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true });

  const offset = (page - 1) * MEMBERS_PER_PAGE;

  // Map sort field to column
  const sortColumn: Record<string, string> = {
    username: "username",
    joined: "user_regdate",
    posts: "user_posts",
    location: "user_from",
  };
  const col = sortColumn[sortBy] ?? "username";

  const { data: members } = await supabase
    .from("profiles")
    .select("id, username, user_from, user_regdate, user_posts, user_website, user_viewemail")
    .order(col, { ascending: order === "asc" })
    .range(offset, offset + MEMBERS_PER_PAGE - 1);

  const tpl = createPageTemplate({
    user: user
      ? { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel }
      : null,
    pageTitle: "Memberlist",
  });

  tpl.loadFile("body", "memberlist_body.tpl");

  const pagination = generatePagination(
    "/memberlist",
    totalMembers ?? 0,
    MEMBERS_PER_PAGE,
    page
  );

  // Sort mode select
  const sortOptions = [
    { value: "username", label: "Username" },
    { value: "joined", label: "Joined Date" },
    { value: "posts", label: "Posts" },
    { value: "location", label: "Location" },
  ];
  const sortSelect = `<select name="sort">${sortOptions
    .map(
      (o) =>
        `<option value="${o.value}"${
          o.value === sortBy ? ' selected="selected"' : ""
        }>${o.label}</option>`
    )
    .join("")}</select>`;

  const orderSelect = `<select name="order"><option value="asc"${
    order === "asc" ? ' selected="selected"' : ""
  }>Ascending</option><option value="desc"${
    order === "desc" ? ' selected="selected"' : ""
  }>Descending</option></select>`;

  tpl.assignVars({
    U_INDEX: "/",
    L_INDEX: "Index",
    S_MODE_ACTION: "/memberlist",
    L_SELECT_SORT_METHOD: "Select sort method",
    S_MODE_SELECT: sortSelect,
    L_ORDER: "Order",
    S_ORDER_SELECT: orderSelect,
    L_SUBMIT: "Go",
    L_USERNAME: "Username",
    L_EMAIL: "E-mail",
    L_FROM: "Location",
    L_JOINED: "Joined",
    L_POSTS: "Posts",
    L_WEBSITE: "Website",
    PAGINATION: pagination.html,
    PAGE_NUMBER: pagination.pageNumber,
    S_TIMEZONE: "All times are GMT",
    JUMPBOX: await fetchAndRenderJumpbox(supabase),
  });

  if (members) {
    let rowIndex = 0;
    for (const member of members) {
      const rowClass = rowIndex % 2 === 0 ? "row1" : "row2";
      tpl.assignBlockVars("memberrow", {
        ROW_CLASS: rowClass,
        ROW_NUMBER: String(offset + rowIndex + 1),
        USERNAME: member.username,
        U_VIEWPROFILE: `/profile/${member.id}`,
        FROM: member.user_from ?? "",
        JOINED: formatPhpBBDate(member.user_regdate, true),
        POSTS: String(member.user_posts ?? 0),
        PM_IMG: user
          ? `<a href="/privmsg?mode=post&u=${member.id}"><img src="templates/Solaris/images/lang_english/icon_pm.gif" alt="PM" border="0" /></a>`
          : "",
        EMAIL_IMG: member.user_viewemail ? "[email]" : "",
        WWW_IMG: member.user_website
          ? `<a href="${member.user_website}" target="_blank"><img src="templates/Solaris/images/icon_www.gif" alt="Website" border="0" /></a>`
          : "",
      });
      rowIndex++;
    }
  }

  return c.html(renderPage(tpl));
});

// ─── Helpers ──────────────────────────────────────────────────

function getRank(
  postCount: number,
  userRank: number,
  ranks: any[]
): { title: string; image: string | null } {
  if (userRank > 0) {
    const special = ranks.find(
      (r: any) => r.id === userRank && r.rank_special
    );
    if (special)
      return { title: special.rank_title, image: special.rank_image };
  }

  const autoRanks = ranks
    .filter((r: any) => !r.rank_special)
    .sort((a: any, b: any) => b.rank_min - a.rank_min);

  for (const rank of autoRanks) {
    if (postCount >= rank.rank_min) {
      return { title: rank.rank_title, image: rank.rank_image };
    }
  }

  return { title: "", image: null };
}

interface ProfileEditOpts {
  user: { id: string; username: string; unreadPms: number };
  profileData: any;
  error?: string;
  avatarConfig?: AvatarConfig;
}

function renderProfileEditForm(opts: ProfileEditOpts): string {
  const { user, profileData, error, avatarConfig } = opts;
  const maxW = avatarConfig?.maxWidth ?? 200;
  const maxH = avatarConfig?.maxHeight ?? 200;
  const maxFilesize = avatarConfig?.maxFilesize ?? 6291456;

  const tpl = createPageTemplate({
    user: { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel },
    pageTitle: "Edit Profile",
  });

  tpl.loadFile("body", "profile_add_body.tpl");

  const errorBox = error ? renderErrorBox(error) : "";

  tpl.assignVars({
    S_PROFILE_ACTION: "/profile",
    S_FORM_ENCTYPE: 'enctype="multipart/form-data"',
    ERROR_BOX: errorBox,
    U_INDEX: "/",
    L_INDEX: "Index",

    L_REGISTRATION_INFO: "Registration Information",
    L_ITEMS_REQUIRED: "Items marked with a * are required unless stated otherwise.",
    L_USERNAME: "Username",
    USERNAME: profileData.username,
    L_EMAIL_ADDRESS: "E-mail address",
    EMAIL: user.username, // email from auth

    // Password fields
    L_CURRENT_PASSWORD: "Current password",
    L_CONFIRM_PASSWORD_EXPLAIN: "You must confirm your current password if you wish to change it or alter your e-mail address",
    CUR_PASSWORD: "",
    L_NEW_PASSWORD: "New password",
    L_PASSWORD_IF_CHANGED: "You only need to supply a password if you want to change it",
    NEW_PASSWORD: "",
    L_CONFIRM_PASSWORD: "Confirm password",
    L_PASSWORD_CONFIRM_IF_CHANGED: "You only need to confirm your password if you changed it above",
    PASSWORD_CONFIRM: "",

    // Profile info
    L_PROFILE_INFO: "Profile Information",
    L_PROFILE_INFO_NOTICE: "This information will be publicly viewable",
    L_ICQ_NUMBER: "ICQ Number",
    ICQ: "",
    L_AIM: "AIM Address",
    AIM: "",
    L_MESSENGER: "MSN Messenger",
    MSN: "",
    L_YAHOO: "Yahoo Messenger",
    YIM: "",
    L_WEBSITE: "Website",
    WEBSITE: profileData.user_website ?? "",
    L_LOCATION: "Location",
    LOCATION: profileData.user_from ?? "",
    L_OCCUPATION: "Occupation",
    OCCUPATION: profileData.user_occ ?? "",
    L_INTERESTS: "Interests",
    INTERESTS: profileData.user_interests ?? "",

    // Signature
    L_SIGNATURE: "Signature",
    L_SIGNATURE_EXPLAIN: "This is a block of text that can be added to posts you make",
    SIGNATURE: profileData.user_sig ?? "",
    HTML_STATUS: "HTML is OFF",
    BBCODE_STATUS: '<a href="/faq" target="_phpbbcode">BBCode</a> is <u>ON</u>',
    SMILIES_STATUS: "Smilies are ON",

    // Preferences
    L_PREFERENCES: "Preferences",
    L_PUBLIC_VIEW_EMAIL: "Always show my e-mail address",
    VIEW_EMAIL_YES: profileData.user_viewemail ? 'checked="checked"' : "",
    VIEW_EMAIL_NO: !profileData.user_viewemail ? 'checked="checked"' : "",
    L_YES: "Yes",
    L_NO: "No",
    L_HIDE_USER: "Hide your online status",
    HIDE_USER_YES: !profileData.user_allow_viewonline
      ? 'checked="checked"'
      : "",
    HIDE_USER_NO: profileData.user_allow_viewonline
      ? 'checked="checked"'
      : "",
    L_NOTIFY_ON_REPLY: "Always notify me of replies",
    L_NOTIFY_ON_REPLY_EXPLAIN: "Sends an e-mail when someone replies to a topic you have posted in. This can be changed whenever you post.",
    NOTIFY_REPLY_YES: profileData.user_notify ? 'checked="checked"' : "",
    NOTIFY_REPLY_NO: !profileData.user_notify ? 'checked="checked"' : "",
    L_NOTIFY_ON_PRIVMSG: "Notify on new Private Message",
    NOTIFY_PM_YES: 'checked="checked"',
    NOTIFY_PM_NO: "",
    L_POPUP_ON_PRIVMSG: "Pop up window on new Private Message",
    L_POPUP_ON_PRIVMSG_EXPLAIN: "Some templates may open a new window to inform you when new private messages arrive.",
    POPUP_PM_YES: "",
    POPUP_PM_NO: 'checked="checked"',
    L_ALWAYS_ADD_SIGNATURE: "Always attach my signature",
    ALWAYS_ADD_SIGNATURE_YES: profileData.user_attachsig
      ? 'checked="checked"'
      : "",
    ALWAYS_ADD_SIGNATURE_NO: !profileData.user_attachsig
      ? 'checked="checked"'
      : "",
    L_ALWAYS_ALLOW_BBCODE: "Always allow BBCode",
    ALWAYS_ALLOW_BBCODE_YES: 'checked="checked"',
    ALWAYS_ALLOW_BBCODE_NO: "",
    L_ALWAYS_ALLOW_HTML: "Always allow HTML",
    ALWAYS_ALLOW_HTML_YES: "",
    ALWAYS_ALLOW_HTML_NO: 'checked="checked"',
    L_ALWAYS_ALLOW_SMILIES: "Always enable Smilies",
    ALWAYS_ALLOW_SMILIES_YES: 'checked="checked"',
    ALWAYS_ALLOW_SMILIES_NO: "",
    L_BOARD_LANGUAGE: "Board Language",
    LANGUAGE_SELECT: "English",
    L_BOARD_STYLE: "Board Style",
    STYLE_SELECT: "Solaris",
    L_TIMEZONE: "Timezone",
    TIMEZONE_SELECT: `<select name="timezone"><option value="UTC" selected>UTC</option></select>`,
    L_DATE_FORMAT: "Date format",
    L_DATE_FORMAT_EXPLAIN: 'The syntax used is identical to the PHP <a href="https://www.php.net/date" target="_other">date()</a> function.',
    DATE_FORMAT: profileData.user_dateformat ?? "DD Mon YYYY HH24:MI",

    // Avatar
    L_AVATAR_PANEL: "Avatar control panel",
    L_AVATAR_EXPLAIN:
      `Displays a small graphic image below your details in posts. Only one image can be displayed at a time, its width can be no greater than ${maxW} pixels, the height no greater than ${maxH} pixels, and the file size no more than ${maxFilesize} bytes.`,
    L_CURRENT_IMAGE: "Current Image",
    AVATAR: profileData.user_avatar
      ? `<img src="${profileData.user_avatar}" alt="Avatar" />`
      : "No avatar",
    L_DELETE_AVATAR: "Delete Image",
    L_UPLOAD_AVATAR_FILE: "Upload Avatar from your machine",
    AVATAR_SIZE: String(maxFilesize),
    L_SUBMIT: "Submit",
    L_RESET: "Reset",
    S_HIDDEN_FIELDS: "",
  });

  // Enable edit profile switches
  tpl.assignBlockVars("switch_edit_profile", {});
  tpl.assignBlockVars("switch_avatar_block", {});
  tpl.assignBlockVars("switch_avatar_block.switch_avatar_local_upload", {});

  return renderPage(tpl);
}

export default profile;
