import { Hono } from "hono";
import { createPageTemplate, renderPage, fmtDate, fmtDateOnly, fetchAndRenderJumpbox, ADMIN_COLOR, MOD_COLOR, timezoneNotice } from "../lib/render.js";
import { getSupabaseAdmin } from "../db/client.js";
import { markAllRead, markForumRead } from "../lib/readtracking.js";
import { validateQueryCsrf } from "../lib/csrf.js";
import { USER_LEVEL } from "../lib/userLevel.js";
import { escapeHtml } from "../lib/escape.js";
import { markup, type MarkupString } from "../lib/markup.js";

const pages = new Hono();

// ─── FAQ Page ─────────────────────────────────────────────────

const faqData = [
  {
    title: "Login and Registration Issues",
    questions: [
      {
        q: "Why can't I log in?",
        a: "Make sure you are using the correct username and password. If you have forgotten your password, use the password reset function.",
      },
      {
        q: "Why do I need to register at all?",
        a: "You may not have to — the administrator may allow unregistered users to post. However, registration gives you additional features like private messaging, avatars, and more.",
      },
      {
        q: "I registered but cannot log in!",
        a: "Check the email you used to register for an activation link. If you did not receive it, your email address may be incorrect.",
      },
    ],
  },
  {
    title: "User Preferences and Settings",
    questions: [
      {
        q: "How do I change my settings?",
        a: 'Click the "Profile" link at the top of the page. This will allow you to change all of your settings.',
      },
      {
        q: "How do I add an avatar?",
        a: "Go to your Profile settings page and upload or link an avatar image.",
      },
      {
        q: "How do I change my rank?",
        a: "Ranks are assigned by the board administrator. You cannot change your own rank. Posting more may automatically advance your rank.",
      },
    ],
  },
  {
    title: "Posting Issues",
    questions: [
      {
        q: "How do I post a topic?",
        a: 'Navigate to the forum you want to post in and click the "New Topic" button.',
      },
      {
        q: "How do I edit or delete a post?",
        a: "You can edit or delete your own posts using the edit/delete buttons on each post. Moderators can edit or delete any post.",
      },
      {
        q: "What is BBCode?",
        a: "BBCode is a special implementation of HTML. You can use tags like [b]bold[/b], [i]italic[/i], [url]links[/url], and more.",
      },
      {
        q: "What are smilies?",
        a: "Smilies are small images that can be used to express emotion. They are typically typed as codes like :) or :D.",
      },
    ],
  },
  {
    title: "Private Messaging",
    questions: [
      {
        q: "I cannot send private messages!",
        a: "You may not have registered or the administrator may have disabled private messaging for your account.",
      },
      {
        q: "I keep getting unwanted private messages!",
        a: "Contact a board administrator to report the user.",
      },
    ],
  },
];

pages.get("/faq", async (c) => {
  const user = c.get("user");
  const supabase = getSupabaseAdmin();

  const tpl = createPageTemplate({
    user: user
      ? { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel }
      : null,
    pageTitle: "FAQ",
  });

  tpl.loadFile("body", "faq_body.tpl");

  tpl.assignVars({
    U_INDEX: "/",
    L_INDEX: "Index",
    L_FAQ_TITLE: "Frequently Asked Questions",
    L_BACK_TO_TOP: "Back to top",
    S_TIMEZONE: timezoneNotice(c),
    JUMPBOX: await fetchAndRenderJumpbox(supabase, undefined, { user }),
  });

  // The template uses <a name="X"> for anchors, which is deprecated in HTML5.
  // Modern browsers use id="" for fragment navigation. Add id alongside name
  // without modifying the original .tpl file.
  tpl.registerSubstitution(
    /<a name="([^"]+)"><\/a>/g,
    '<a name="$1" id="$1"></a>'
  );

  // Top-of-page link index (uses numeric IDs like phpBB2)
  let faqCounter = 0;
  for (const block of faqData) {
    tpl.assignBlockVars("faq_block_link", {
      BLOCK_TITLE: block.title,
    });
    for (const _q of block.questions) {
      tpl.assignBlockVars("faq_block_link.faq_row_link", {
        U_FAQ_LINK: `#faq_${faqCounter}`,
        FAQ_LINK: _q.q,
      });
      faqCounter++;
    }
  }

  // Full Q&A blocks
  faqCounter = 0;
  let rowIndex = 0;
  for (const block of faqData) {
    tpl.assignBlockVars("faq_block", {
      BLOCK_TITLE: block.title,
    });
    for (const q of block.questions) {
      tpl.assignBlockVars("faq_block.faq_row", {
        ROW_CLASS: rowIndex % 2 === 0 ? "row1" : "row2",
        U_FAQ_ID: `faq_${faqCounter}`,
        FAQ_QUESTION: q.q,
        FAQ_ANSWER: q.a,
      });
      faqCounter++;
      rowIndex++;
    }
  }

  return c.html(renderPage(tpl));
});

// ─── Who's Online ─────────────────────────────────────────────

pages.get("/viewonline", async (c) => {
  const user = c.get("user");
  const supabase = getSupabaseAdmin();
  const adminDb = getSupabaseAdmin();

  // Get recent sessions (last 5 minutes)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const [{ data: sessions }, jumpboxHtml] = await Promise.all([
    adminDb
      .from("sessions")
      // user_allow_viewonline is needed to honour "Hide your online status".
      .select("*, profiles(id, username, user_level, user_allow_viewonline)")
      .gte("session_time", fiveMinAgo)
      .order("session_time", { ascending: false }),
    fetchAndRenderJumpbox(supabase, undefined, { user }),
  ]);

  // Respect the "Hide your online status" preference, the way the index
  // already does (src/routes/index.ts). /viewonline ignored it entirely, so
  // opting out hid you from one page and not the other. Hidden users still
  // count as present but are not named.
  const allRegistered = (sessions ?? []).filter(
    (s: any) => s.session_logged_in && s.profiles
  );
  const registered = allRegistered.filter(
    (s: any) => s.profiles?.user_allow_viewonline !== false
  );
  const hiddenCount = allRegistered.length - registered.length;
  const guests = (sessions ?? []).filter((s: any) => !s.session_logged_in);

  const tpl = createPageTemplate({
    user: user
      ? { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel }
      : null,
    pageTitle: "Who is Online",
  });

  tpl.loadFile("body", "viewonline_body.tpl");

  tpl.assignVars({
    U_INDEX: "/",
    L_INDEX: "Index",
    L_USERNAME: "Username",
    L_LAST_UPDATE: "Last Updated",
    L_FORUM_LOCATION: "Forum Location",
    L_ONLINE_EXPLAIN: "This data is based on users active over the past five minutes",
    S_TIMEZONE: timezoneNotice(c),
    JUMPBOX: jumpboxHtml,
    TOTAL_REGISTERED_USERS_ONLINE:
      `Registered Users Online: ${registered.length}` +
      (hiddenCount > 0 ? `  |  Hidden Users Online: ${hiddenCount}` : ""),
    TOTAL_GUEST_USERS_ONLINE: `Guest Users Online: ${guests.length}`,
  });

  let rowIndex = 0;
  for (const s of registered) {
    const profile = s.profiles as any;
    const userLevel = profile?.user_level ?? 0;
    const safeName = escapeHtml(profile?.username ?? "Unknown");
    let styledUsername: MarkupString;
    if (userLevel === USER_LEVEL.ADMIN) {
      styledUsername = markup(`<b style="color:${ADMIN_COLOR}">${safeName}</b>`);
    } else if (userLevel === USER_LEVEL.MOD) {
      styledUsername = markup(`<b style="color:${MOD_COLOR}">${safeName}</b>`);
    } else {
      styledUsername = markup(safeName);
    }
    tpl.assignBlockVars("reg_user_row", {
      ROW_CLASS: rowIndex % 2 === 0 ? "row1" : "row2",
      USERNAME: styledUsername,
      U_USER_PROFILE: `/profile/${encodeURIComponent(profile?.id ?? "")}`,
      LASTUPDATE: fmtDate(c, s.session_time),
      // Deliberately NOT the raw session_page. That column records the exact
      // path being viewed — /viewforum/<private id>, /privmsg?mode=read&p=N,
      // /admin/... — and this page is readable by anonymous visitors.
      FORUM_LOCATION: describeLocation(s.session_page),
      U_FORUM_LOCATION: "/",
    });
    rowIndex++;
  }

  rowIndex = 0;
  for (const s of guests) {
    tpl.assignBlockVars("guest_user_row", {
      ROW_CLASS: rowIndex % 2 === 0 ? "row1" : "row2",
      USERNAME: "Guest",
      LASTUPDATE: fmtDate(c, s.session_time),
      FORUM_LOCATION: s.session_page ?? "Index",
      U_FORUM_LOCATION: "/",
    });
    rowIndex++;
  }

  return c.html(renderPage(tpl));
});

// ─── Mark Forums Read ─────────────────────────────────────────

/**
 * "Mark forums read" — the whole board, or one forum with ?f=N.
 *
 * A GET that mutates, because phpBB2 drives it from a plain link in the
 * template and we render templates unmodified. It therefore carries the CSRF
 * token in its query string, like the other link-triggered actions.
 *
 * Marking read is idempotent and affects only the caller's own rows, so the
 * consequences of a forged one are nil — but it's gated anyway rather than
 * leaving a mutating GET as the one exception to the rule.
 */
pages.get("/markread", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/");
  if (!validateQueryCsrf(c)) return c.text("CSRF token mismatch", 403);

  const db = getSupabaseAdmin();
  const forumId = parseInt(c.req.query("f") ?? "0", 10);

  if (forumId > 0) {
    await markForumRead(db, user.id, forumId);
    return c.redirect(`/viewforum/${forumId}`);
  }

  await markAllRead(db, user.id);
  return c.redirect("/");
});

/**
 * Turn a recorded session path into a coarse, non-identifying description.
 *
 * sessions.session_page holds the exact path a user was last on, and
 * /viewonline is readable by anonymous visitors — so rendering it raw handed
 * out private forum ids, the ids of private messages being read, and which
 * admin screens the admin was using. phpBB2 showed a location, not a URL;
 * this shows the same kind of thing without the identifiers.
 */
function describeLocation(path: string | null | undefined): string {
  if (!path || path === "/") return "Viewing the index";
  if (path.startsWith("/viewforum")) return "Viewing a forum";
  if (path.startsWith("/viewtopic")) return "Reading a topic";
  if (path.startsWith("/posting")) return "Posting a message";
  if (path.startsWith("/privmsg")) return "Viewing private messages";
  if (path.startsWith("/profile")) return "Viewing a profile";
  if (path.startsWith("/memberlist")) return "Viewing the member list";
  if (path.startsWith("/search")) return "Searching the forums";
  if (path.startsWith("/groupcp")) return "Viewing group information";
  if (path.startsWith("/modcp")) return "Moderating";
  if (path.startsWith("/admin")) return "Administering the board";
  if (path.startsWith("/faq")) return "Viewing the FAQ";
  if (path.startsWith("/viewonline")) return "Viewing who is online";
  if (path.startsWith("/login") || path.startsWith("/register")) return "Logging in";
  return "Viewing the index";
}

export default pages;
