import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { createPageTemplate, renderPage, formatPhpBBDate } from "../lib/render.js";

const pages = new Hono();

function getAdminDb() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

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

  const tpl = createPageTemplate({
    user: user
      ? { id: user.id, username: user.username, unreadPms: user.unreadPms }
      : null,
    pageTitle: "FAQ",
  });

  tpl.loadFile("body", "faq_body.tpl");

  tpl.assignVars({
    U_INDEX: "/",
    L_INDEX: "Index",
    L_FAQ_TITLE: "Frequently Asked Questions",
    L_BACK_TO_TOP: "Back to top",
    S_TIMEZONE: "All times are GMT",
    JUMPBOX: "",
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
  const adminDb = getAdminDb();

  // Get recent sessions (last 5 minutes)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data: sessions } = await adminDb
    .from("sessions")
    .select("*, profiles(id, username)")
    .gte("session_time", fiveMinAgo)
    .order("session_time", { ascending: false });

  const registered = (sessions ?? []).filter(
    (s: any) => s.session_logged_in && s.profiles
  );
  const guests = (sessions ?? []).filter((s: any) => !s.session_logged_in);

  const tpl = createPageTemplate({
    user: user
      ? { id: user.id, username: user.username, unreadPms: user.unreadPms }
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
    S_TIMEZONE: "All times are GMT",
    JUMPBOX: "",
    TOTAL_REGISTERED_USERS_ONLINE: `Registered Users Online: ${registered.length}`,
    TOTAL_GUEST_USERS_ONLINE: `Guest Users Online: ${guests.length}`,
  });

  let rowIndex = 0;
  for (const s of registered) {
    const profile = s.profiles as any;
    tpl.assignBlockVars("reg_user_row", {
      ROW_CLASS: rowIndex % 2 === 0 ? "row1" : "row2",
      USERNAME: profile?.username ?? "Unknown",
      U_USER_PROFILE: `/profile/${profile?.id ?? ""}`,
      LASTUPDATE: formatPhpBBDate(s.session_time),
      FORUM_LOCATION: s.session_page ?? "Index",
      U_FORUM_LOCATION: "/",
    });
    rowIndex++;
  }

  rowIndex = 0;
  for (const s of guests) {
    tpl.assignBlockVars("guest_user_row", {
      ROW_CLASS: rowIndex % 2 === 0 ? "row1" : "row2",
      USERNAME: "Guest",
      LASTUPDATE: formatPhpBBDate(s.session_time),
      FORUM_LOCATION: s.session_page ?? "Index",
      U_FORUM_LOCATION: "/",
    });
    rowIndex++;
  }

  return c.html(renderPage(tpl));
});

// ─── Mark Forums Read ─────────────────────────────────────────

pages.get("/markread", async (c) => {
  // phpBB2 style "mark forums read" — just redirect to index
  // In a full implementation this would update a tracking table
  return c.redirect("/");
});

export default pages;
