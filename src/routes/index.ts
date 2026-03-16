import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { createPageTemplate, renderPage, formatPhpBBDate } from "../lib/render.js";

const index = new Hono();

index.get("/", async (c) => {
  const user = c.get("user");
  const supabase = c.get("supabase");

  // Use admin client for session queries (sessions may not be readable via anon)
  const adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const tpl = createPageTemplate({
    user: user ? { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel } : null,
    pageTitle: "Index",
  });

  tpl.loadFile("body", "index_body.tpl");

  // Fetch categories with their forums
  const { data: categories } = await supabase
    .from("categories")
    .select("*")
    .order("cat_order");

  const { data: forums } = await supabase
    .from("forums")
    .select("*")
    .order("forum_order");

  // Get total stats
  const { count: totalPosts } = await supabase
    .from("posts")
    .select("*", { count: "exact", head: true });

  const { count: totalUsers } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true });

  const { data: newestUser } = await supabase
    .from("profiles")
    .select("id, username")
    .order("user_regdate", { ascending: false })
    .limit(1)
    .single();

  // Online user stats (last 5 minutes)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: activeSessions } = await adminDb
    .from("sessions")
    .select("user_id, session_logged_in, profiles(id, username, user_allow_viewonline)")
    .gte("session_time", fiveMinAgo);

  const onlineRegistered: { id: string; username: string }[] = [];
  let hiddenCount = 0;
  let guestCount = 0;

  const seenUsers = new Set<string>();
  for (const s of activeSessions ?? []) {
    if (s.session_logged_in && s.profiles) {
      const profile = s.profiles as any;
      if (!seenUsers.has(profile.id)) {
        seenUsers.add(profile.id);
        if (profile.user_allow_viewonline) {
          onlineRegistered.push({ id: profile.id, username: profile.username });
        } else {
          hiddenCount++;
        }
      }
    } else {
      guestCount++;
    }
  }

  const totalOnline = onlineRegistered.length + hiddenCount + guestCount;
  const totalOnlineStr = totalOnline === 1
    ? `In total there is <b>${totalOnline}</b> user online :: `
    : `In total there are <b>${totalOnline}</b> users online :: `;
  const regStr = `${onlineRegistered.length} Registered, `;
  const hidStr = `${hiddenCount} Hidden and `;
  const guestStr = guestCount === 1 ? `${guestCount} Guest` : `${guestCount} Guests`;

  const userListStr = onlineRegistered.length > 0
    ? onlineRegistered.map((u) => `<a href="/profile/${u.id}">${u.username}</a>`).join(", ")
    : "None";

  const newestUserStr = newestUser
    ? `The newest registered user is <b><a href="/profile/${newestUser.id}">${newestUser.username}</a></b>`
    : "The newest registered user is <b>Nobody</b>";

  tpl.assignVars({
    // Index labels
    L_INDEX: "Index",
    U_INDEX: "/",
    L_FORUM: "Forum",
    L_TOPICS: "Topics",
    L_POSTS: "Posts",
    L_LASTPOST: "Last Post",
    L_WHO_IS_ONLINE: "Who is Online",
    L_WHOSONLINE_ADMIN: "Admin",
    L_WHOSONLINE_MOD: "Mod",
    L_ONLINE_EXPLAIN: "This data is based on users active over the past five minutes",
    L_NEW_POSTS: "New posts",
    L_NO_NEW_POSTS: "No new posts",
    L_FORUM_LOCKED: "Forum locked",
    L_MARK_FORUMS_READ: "Mark all forums read",

    // Stats
    TOTAL_POSTS: `Our users have posted a total of <b>${totalPosts ?? 0}</b> article${(totalPosts ?? 0) !== 1 ? "s" : ""}`,
    TOTAL_USERS: `We have <b>${totalUsers ?? 0}</b> registered user${(totalUsers ?? 0) !== 1 ? "s" : ""}`,
    NEWEST_USER: newestUserStr,
    TOTAL_USERS_ONLINE: totalOnlineStr + regStr + hidStr + guestStr,
    RECORD_USERS: `Most users ever online was <b>${totalOnline}</b> on ${formatPhpBBDate(new Date())}`,
    LOGGED_IN_USER_LIST: `Registered users: ${userListStr}`,
    CURRENT_TIME: `The time now is ${formatPhpBBDate(new Date())}`,

    // Links
    U_VIEWONLINE: "/viewonline",
    U_MARK_READ: "/markread",
    S_TIMEZONE: "All times are GMT",

    // Login form (shown for logged-out users)
    S_LOGIN_ACTION: "/login",
    L_USERNAME: "Username",
    L_PASSWORD: "Password",
    L_AUTO_LOGIN: "Log me on automatically each visit",
    L_LOGIN: "Log in",

    // Search links
    U_SEARCH_NEW: "/search?mode=new",
    U_SEARCH_SELF: "/search?mode=self",
    L_SEARCH_NEW: "View posts since last visit",
    L_SEARCH_SELF: "View your posts",
    U_SEARCH_UNANSWERED: "/search?mode=unanswered",
    L_SEARCH_UNANSWERED: "View unanswered posts",
    LAST_VISIT_DATE: user?.lastVisit
      ? `You last visited on ${formatPhpBBDate(user.lastVisit)}`
      : "",
  });

  if (!user) {
    tpl.assignBlockVars("switch_allow_autologin", {});
  }

  // Fetch last post info for forums that have posts
  const forumLastPostIds = (forums ?? [])
    .map((f: any) => f.forum_last_post_id)
    .filter(Boolean);

  let lastPostMap: Record<number, { time: string; username: string; userId: string; topicId: number }> = {};
  if (forumLastPostIds.length > 0) {
    const { data: lastPosts } = await supabase
      .from("posts")
      .select("id, post_time, poster_id, topic_id, profiles(username)")
      .in("id", forumLastPostIds);

    if (lastPosts) {
      for (const lp of lastPosts) {
        const profile = lp.profiles as any;
        lastPostMap[lp.id] = {
          time: lp.post_time,
          username: profile?.username ?? "Guest",
          userId: lp.poster_id,
          topicId: lp.topic_id,
        };
      }
    }
  }

  // Fetch moderators for all forums
  const forumIds = (forums ?? []).map((f: any) => f.id);
  let forumModMap: Record<number, { id: string; username: string }[]> = {};
  if (forumIds.length > 0) {
    const { data: modEntries } = await supabase
      .from("auth_access")
      .select("forum_id, groups(group_name, user_group(user_id, profiles(id, username)))")
      .in("forum_id", forumIds)
      .eq("auth_mod", true);

    if (modEntries) {
      const seen = new Set<string>();
      for (const me of modEntries) {
        const fid = me.forum_id;
        if (!forumModMap[fid]) forumModMap[fid] = [];
        const group = me.groups as any;
        if (group?.user_group) {
          for (const ug of group.user_group) {
            const profile = ug.profiles as any;
            const key = `${fid}:${profile?.id}`;
            if (profile && !seen.has(key)) {
              seen.add(key);
              forumModMap[fid].push({ id: profile.id, username: profile.username });
            }
          }
        }
      }
    }
  }

  // Build category/forum blocks
  if (categories && forums) {
    for (const cat of categories) {
      tpl.assignBlockVars("catrow", {
        U_VIEWCAT: `/category/${cat.id}`,
        CAT_DESC: cat.cat_title,
      });

      const catForums = forums.filter((f: any) => f.cat_id === cat.id);
      for (const forum of catForums) {
        let lastPostText = "No posts";
        if (forum.forum_last_post_id && lastPostMap[forum.forum_last_post_id]) {
          const lp = lastPostMap[forum.forum_last_post_id];
          lastPostText =
            `${formatPhpBBDate(lp.time)}<br />` +
            `<a href="/profile/${lp.userId}">${lp.username}</a> ` +
            `<a href="/viewtopic/${lp.topicId}#${forum.forum_last_post_id}">` +
            `<img src="templates/Solaris/images/icon_latest_reply.gif" alt="Latest Reply" border="0" /></a>`;
        }

        tpl.assignBlockVars("catrow.forumrow", {
          FORUM_FOLDER_IMG: "templates/Solaris/images/folder.gif",
          U_VIEWFORUM: `/viewforum/${forum.id}`,
          FORUM_NAME: forum.forum_name,
          FORUM_DESC: forum.forum_desc ?? "",
          L_MODERATOR: "Moderator:",
          MODERATORS: (forumModMap[forum.id] ?? []).length > 0
            ? forumModMap[forum.id].map((m: any) => `<a href="/profile/${m.id}">${m.username}</a>`).join(", ")
            : "None",
          TOPICS: String(forum.forum_topics ?? 0),
          POSTS: String(forum.forum_posts ?? 0),
          LAST_POST: lastPostText,
        });
      }
    }
  }

  return c.html(renderPage(tpl));
});

export default index;
