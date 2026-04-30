import { Hono } from "hono";
import { createPageTemplate, renderPage, formatPhpBBDate, formatUsernameLink, ADMIN_COLOR, MOD_COLOR } from "../lib/render.js";
import { getSupabaseAdmin } from "../db/client.js";
import { escapeHtml } from "../lib/escape.js";
import { markup } from "../lib/markup.js";

const index = new Hono();

index.get("/", async (c) => {
  const user = c.get("user");
  const supabase = c.get("supabase");

  // Use admin client for session queries (sessions may not be readable via anon)
  const adminDb = getSupabaseAdmin();

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
    .maybeSingle();

  // Online user stats (last 5 minutes)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: activeSessions } = await adminDb
    .from("sessions")
    .select("user_id, session_logged_in, profiles(id, username, user_allow_viewonline, user_level)")
    .gte("session_time", fiveMinAgo);

  const onlineRegistered: { id: string; username: string; userLevel: number }[] = [];
  let hiddenCount = 0;
  let guestCount = 0;

  const seenUsers = new Set<string>();
  for (const s of activeSessions ?? []) {
    if (s.session_logged_in && s.profiles) {
      const profile = s.profiles as any;
      if (!seenUsers.has(profile.id)) {
        seenUsers.add(profile.id);
        if (profile.user_allow_viewonline) {
          onlineRegistered.push({ id: profile.id, username: profile.username, userLevel: profile.user_level ?? 0 });
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

  const userListHtml = onlineRegistered.length > 0
    ? onlineRegistered.map((u) => formatUsernameLink(u.id, u.username, u.userLevel).html).join(", ")
    : "None";

  const newestUserStr = newestUser
    ? `The newest registered user is <b><a href="/profile/${encodeURIComponent(newestUser.id)}">${escapeHtml(newestUser.username)}</a></b>`
    : "The newest registered user is <b>Nobody</b>";

  // Track the all-time online record in the config table. Cheap when
  // the current count doesn't beat the record (single read), and keeps
  // the displayed "Most users ever online" actually meaningful.
  const { data: recordRow } = await adminDb
    .from("config")
    .select("config_value")
    .eq("config_name", "record_users_online")
    .maybeSingle();
  const { data: recordDateRow } = await adminDb
    .from("config")
    .select("config_value")
    .eq("config_name", "record_users_online_date")
    .maybeSingle();
  let recordCount = parseInt(recordRow?.config_value ?? "0", 10) || 0;
  let recordDate = recordDateRow?.config_value ?? new Date().toISOString();
  if (totalOnline > recordCount) {
    recordCount = totalOnline;
    recordDate = new Date().toISOString();
    await adminDb.from("config").upsert([
      { config_name: "record_users_online", config_value: String(recordCount) },
      { config_name: "record_users_online_date", config_value: recordDate },
    ]);
  }

  tpl.assignVars({
    // Index labels
    L_INDEX: "Index",
    U_INDEX: "/",
    L_FORUM: "Forum",
    L_TOPICS: "Topics",
    L_POSTS: "Posts",
    L_LASTPOST: "Last Post",
    L_WHO_IS_ONLINE: "Who is Online",
    L_WHOSONLINE_ADMIN: markup(`<span style="color:${ADMIN_COLOR}"><b>Administrator</b></span>`),
    L_WHOSONLINE_MOD: markup(`<span style="color:${MOD_COLOR}"><b>Moderator</b></span>`),
    L_ONLINE_EXPLAIN: "This data is based on users active over the past five minutes",
    L_NEW_POSTS: "New posts",
    L_NO_NEW_POSTS: "No new posts",
    L_FORUM_LOCKED: "Forum locked",
    L_MARK_FORUMS_READ: "Mark all forums read",

    // Stats
    TOTAL_POSTS: markup(`Our users have posted a total of <b>${totalPosts ?? 0}</b> article${(totalPosts ?? 0) !== 1 ? "s" : ""}`),
    TOTAL_USERS: markup(`We have <b>${totalUsers ?? 0}</b> registered user${(totalUsers ?? 0) !== 1 ? "s" : ""}`),
    NEWEST_USER: markup(newestUserStr),
    TOTAL_USERS_ONLINE: markup(totalOnlineStr + regStr + hidStr + guestStr),
    RECORD_USERS: markup(`Most users ever online was <b>${recordCount}</b> on ${formatPhpBBDate(recordDate)}`),
    LOGGED_IN_USER_LIST: markup(`Registered users: ${userListHtml}`),
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
    tpl.assignBlockVars("switch_user_logged_out.switch_allow_autologin", {});
  }

  // Fetch last post for each forum.
  // Try the denormalized forum_last_post_id first; fall back to querying
  // the most recent post per forum so the column works even when the
  // denormalized field hasn't been maintained.
  const forumIds = (forums ?? []).map((f: any) => f.id as number);
  let lastPostMap: Record<number, { time: string; username: string; userId: string; topicId: number; postId: number }> = {};

  if (forumIds.length > 0) {
    // First try: batch-fetch by forum_last_post_id for forums that have it
    const knownIds = (forums ?? [])
      .map((f: any) => f.forum_last_post_id)
      .filter((id: any) => id && id > 0);

    let postById: Record<number, any> = {};
    if (knownIds.length > 0) {
      const { data: knownPosts } = await supabase
        .from("posts")
        .select("id, forum_id, post_time, poster_id, topic_id, poster:profiles!posts_poster_id_fkey(id, username)")
        .in("id", knownIds);
      if (knownPosts) {
        for (const p of knownPosts) postById[p.id] = p;
      }
    }

    // Build map from denormalized IDs
    for (const f of forums ?? []) {
      const p = f.forum_last_post_id ? postById[f.forum_last_post_id] : null;
      if (p) {
        const poster = p.poster as any;
        lastPostMap[f.id] = {
          time: p.post_time,
          username: poster?.username ?? "Guest",
          userId: poster?.id ?? p.poster_id,
          topicId: p.topic_id,
          postId: p.id,
        };
      }
    }

    // Second pass: for any forum still missing, query the latest post directly
    const missingForumIds = forumIds.filter((id) => !lastPostMap[id]);
    if (missingForumIds.length > 0) {
      for (const fid of missingForumIds) {
        const { data: latest } = await supabase
          .from("posts")
          .select("id, post_time, poster_id, topic_id, poster:profiles!posts_poster_id_fkey(id, username)")
          .eq("forum_id", fid)
          .order("post_time", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latest) {
          const poster = latest.poster as any;
          lastPostMap[fid] = {
            time: latest.post_time,
            username: poster?.username ?? "Guest",
            userId: poster?.id ?? latest.poster_id,
            topicId: latest.topic_id,
            postId: latest.id,
          };
        }
      }
    }
  }

  // Fetch moderators for all forums
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
        let lastPostText = markup("No posts");
        if (lastPostMap[forum.id]) {
          const lp = lastPostMap[forum.id];
          lastPostText = markup(
            `${formatPhpBBDate(lp.time)}<br />` +
            `<a href="/profile/${encodeURIComponent(lp.userId)}">${escapeHtml(lp.username)}</a> ` +
            `<a href="/viewtopic/${lp.topicId}#${lp.postId}">` +
            `<img src="templates/Solaris/images/icon_latest_reply.gif" alt="Latest Reply" border="0" /></a>`
          );
        }

        const moderatorMarkup = (forumModMap[forum.id] ?? []).length > 0
          ? markup(
              forumModMap[forum.id]
                .map((m: any) => `<a href="/profile/${encodeURIComponent(m.id)}">${escapeHtml(m.username)}</a>`)
                .join(", ")
            )
          : "None";

        tpl.assignBlockVars("catrow.forumrow", {
          FORUM_FOLDER_IMG: "templates/Solaris/images/folder.gif",
          U_VIEWFORUM: `/viewforum/${forum.id}`,
          FORUM_NAME: forum.forum_name,
          FORUM_DESC: forum.forum_desc ?? "",
          L_MODERATOR: "Moderator:",
          MODERATORS: moderatorMarkup,
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
