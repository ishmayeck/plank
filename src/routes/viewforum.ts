import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { createPageTemplate, renderPage, formatPhpBBDate, fetchAndRenderJumpbox } from "../lib/render.js";
import { generatePagination, topicGotoPage } from "../lib/pagination.js";

function getAdminDb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const TOPICS_PER_PAGE = 25;
const POSTS_PER_PAGE = 15;

const viewforum = new Hono();

viewforum.get("/viewforum/:id", async (c) => {
  const forumId = parseInt(c.req.param("id"), 10);
  const page = parseInt(c.req.query("page") ?? "1", 10);
  const user = c.get("user");
  const supabase = c.get("supabase");

  // Fetch forum details
  const { data: forum, error: forumError } = await supabase
    .from("forums")
    .select("*, categories(cat_title)")
    .eq("id", forumId)
    .single();

  if (forumError || !forum) {
    return c.text("Forum not found", 404);
  }

  const tpl = createPageTemplate({
    user: user
      ? { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel }
      : null,
    pageTitle: forum.forum_name,
  });

  tpl.loadFile("body", "viewforum_body.tpl");

  // Get topic count and jumpbox data in parallel
  const [{ count: totalTopics }, jumpboxHtml] = await Promise.all([
    supabase.from("topics").select("*", { count: "exact", head: true }).eq("forum_id", forumId),
    fetchAndRenderJumpbox(supabase, forumId),
  ]);

  const offset = (page - 1) * TOPICS_PER_PAGE;

  // Fetch topics: stickies and announcements first, then by last post
  const { data: topics } = await supabase
    .from("topics")
    .select(
      `
      *,
      poster:profiles!topics_topic_poster_fkey(username)
    `
    )
    .eq("forum_id", forumId)
    .order("topic_type", { ascending: false })
    .order("topic_last_post_id", { ascending: false })
    .range(offset, offset + TOPICS_PER_PAGE - 1);

  // For each topic, get the last post info
  const topicIds = topics?.map((t: any) => t.topic_last_post_id).filter(Boolean) ?? [];
  let lastPosts: Record<number, any> = {};
  if (topicIds.length > 0) {
    const { data: posts } = await supabase
      .from("posts")
      .select("id, post_time, poster:profiles!posts_poster_id_fkey(id, username)")
      .in("id", topicIds);
    if (posts) {
      for (const p of posts) {
        lastPosts[p.id] = p;
      }
    }
  }

  // Fetch forum moderators: groups with auth_mod on this forum, then their members
  const { data: modGroups } = await supabase
    .from("auth_access")
    .select("group_id, groups(group_name, user_group(user_id, profiles(id, username)))")
    .eq("forum_id", forumId)
    .eq("auth_mod", true);

  const moderatorNames: { id: string; username: string }[] = [];
  const seenMods = new Set<string>();
  if (modGroups) {
    for (const mg of modGroups) {
      const group = mg.groups as any;
      if (group?.user_group) {
        for (const ug of group.user_group) {
          const profile = ug.profiles as any;
          if (profile && !seenMods.has(profile.id)) {
            seenMods.add(profile.id);
            moderatorNames.push({ id: profile.id, username: profile.username });
          }
        }
      }
    }
  }

  const moderatorsHtml = moderatorNames.length > 0
    ? moderatorNames.map((m) => `<a href="/profile/${m.id}">${m.username}</a>`).join(", ")
    : "None";

  // Users browsing this forum (active sessions on this page in last 5 minutes)
  const adminDb = getAdminDb();
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: browsingSessions } = await adminDb
    .from("sessions")
    .select("user_id, session_logged_in, profiles(id, username, user_level)")
    .eq("session_page", `/viewforum/${forumId}`)
    .gte("session_time", fiveMinAgo);

  const browsingUsers: string[] = [];
  let browsingGuests = 0;
  const seenBrowsing = new Set<string>();
  for (const s of browsingSessions ?? []) {
    if (s.session_logged_in && s.profiles) {
      const profile = s.profiles as any;
      if (!seenBrowsing.has(profile.id)) {
        seenBrowsing.add(profile.id);
        // Role colors: admin = red, mod = blue
        let cssClass = "";
        if (profile.user_level >= 1) cssClass = ' style="color:#AA0000; font-weight:bold"';
        browsingUsers.push(`<a href="/profile/${profile.id}"${cssClass}>${profile.username}</a>`);
      }
    } else {
      browsingGuests++;
    }
  }

  let browsingStr = "Users browsing this forum: ";
  if (browsingUsers.length > 0) {
    browsingStr += browsingUsers.join(", ");
    if (browsingGuests > 0) browsingStr += `, ${browsingGuests} Guest${browsingGuests !== 1 ? "s" : ""}`;
  } else {
    browsingStr += browsingGuests > 0
      ? `${browsingGuests} Guest${browsingGuests !== 1 ? "s" : ""}`
      : "None";
  }

  const pagination = generatePagination(
    `/viewforum/${forumId}`,
    totalTopics ?? 0,
    TOPICS_PER_PAGE,
    page
  );

  // Assign template variables
  tpl.assignVars({
    FORUM_NAME: forum.forum_name,
    U_VIEW_FORUM: `/viewforum/${forumId}`,
    U_INDEX: "/",
    L_INDEX: "Index",
    L_TOPICS: "Topics",
    L_REPLIES: "Replies",
    L_AUTHOR: "Author",
    L_VIEWS: "Views",
    L_LASTPOST: "Last Post",
    L_POST_NEW_TOPIC: "Post new topic",
    U_POST_NEW_TOPIC: `/posting?mode=newtopic&f=${forumId}`,
    POST_IMG: "templates/Solaris/images/lang_english/new_topic.gif",
    L_MODERATOR: "Moderator",
    MODERATORS: moderatorsHtml,
    LOGGED_IN_USER_LIST: browsingStr,
    L_MARK_TOPICS_READ: "Mark all topics read",
    U_MARK_READ: `/viewforum/${forumId}?mark=topics`,
    L_DISPLAY_TOPICS: "Display topics from previous",
    L_NO_TOPICS: "There are no topics in this forum.",
    L_GO: "Go",
    S_POST_DAYS_ACTION: `/viewforum/${forumId}`,
    S_SELECT_TOPIC_DAYS:
      '<select name="topicdays"><option value="0" selected>All Topics</option><option value="1">1 Day</option><option value="7">7 Days</option><option value="14">2 Weeks</option><option value="30">1 Month</option></select>',
    PAGINATION: pagination.html,
    PAGE_NUMBER: pagination.pageNumber,
    S_TIMEZONE: "All times are GMT",
    JUMPBOX: jumpboxHtml,
    S_AUTH_LIST: buildAuthList(forum, user),

    // Folder icons
    FOLDER_NEW_IMG: "templates/Solaris/images/folder_new.gif",
    FOLDER_IMG: "templates/Solaris/images/folder.gif",
    FOLDER_ANNOUNCE_IMG: "templates/Solaris/images/folder_announce.gif",
    FOLDER_STICKY_IMG: "templates/Solaris/images/folder_sticky.gif",
    FOLDER_LOCKED_NEW_IMG: "templates/Solaris/images/folder_lock_new.gif",
    FOLDER_LOCKED_IMG: "templates/Solaris/images/folder_lock.gif",
    L_NEW_POSTS: "New posts",
    L_NO_NEW_POSTS: "No new posts",
    L_ANNOUNCEMENT: "Announcement",
    L_STICKY: "Sticky",
    L_NEW_POSTS_TOPIC_LOCKED: "New posts [ Locked ]",
    L_NO_NEW_POSTS_TOPIC_LOCKED: "No new posts [ Locked ]",
    L_NEW_POSTS_LOCKED: "New posts [ Locked ]",
    L_NO_NEW_POSTS_LOCKED: "No new posts [ Locked ]",
  });

  // Populate topic rows
  if (topics && topics.length > 0) {
    for (const topic of topics) {
      const lastPost = lastPosts[topic.topic_last_post_id];
      const lastPostTime = lastPost
        ? formatPhpBBDate(lastPost.post_time)
        : "";
      const lastPostPoster = lastPost?.poster as any;
      const lastPostAuthor = lastPostPoster
        ? `<a href="/profile/${lastPostPoster.id}">${lastPostPoster.username}</a>`
        : "";
      const lastPostImg = lastPost
        ? `<a href="/viewtopic/${topic.id}#${topic.topic_last_post_id}"><img src="templates/Solaris/images/icon_latest_reply.gif" alt="View latest post" title="View latest post" border="0" /></a>`
        : "";

      // Determine folder icon and topic type prefix
      let folderImg = "templates/Solaris/images/folder.gif";
      let folderAlt = "No new posts";
      let topicType = "";
      let topicLinkId = topic.id;

      if (topic.topic_status === 2) {
        // Moved — shadow topic pointing to real topic
        topicType = '<b>Moved:</b> ';
        folderAlt = "Topic Moved";
        topicLinkId = topic.topic_moved_id ?? topic.id;
      } else {
        if (topic.topic_status === 1) {
          folderImg = "templates/Solaris/images/folder_lock.gif";
          folderAlt = "Locked";
        } else if (topic.topic_type === 2) {
          folderImg = "templates/Solaris/images/folder_announce.gif";
          folderAlt = "Announcement";
        } else if (topic.topic_type === 1) {
          folderImg = "templates/Solaris/images/folder_sticky.gif";
          folderAlt = "Sticky";
        } else if (topic.topic_replies >= 15) {
          folderImg = "templates/Solaris/images/folder_hot.gif";
          folderAlt = "Hot topic";
        }

        // Topic type prefix (matches phpBB2 lang strings)
        if (topic.topic_type === 2)
          topicType = '<b>Announcement:</b> ';
        else if (topic.topic_type === 1)
          topicType = '<b>Sticky:</b> ';

        if (topic.topic_vote)
          topicType += '<b>[ Poll ]</b> ';
      }

      tpl.assignBlockVars("topicrow", {
        TOPIC_FOLDER_IMG: folderImg,
        L_TOPIC_FOLDER_ALT: folderAlt,
        NEWEST_POST_IMG: "",
        TOPIC_TYPE: topicType,
        U_VIEW_TOPIC: `/viewtopic/${topicLinkId}`,
        TOPIC_TITLE: topic.topic_title,
        GOTO_PAGE: topicGotoPage(
          `/viewtopic/${topic.id}`,
          topic.topic_replies,
          POSTS_PER_PAGE
        ),
        REPLIES: String(topic.topic_replies),
        TOPIC_AUTHOR: topic.poster?.username ?? "Unknown",
        VIEWS: String(topic.topic_views),
        LAST_POST_TIME: lastPostTime,
        LAST_POST_AUTHOR: lastPostAuthor,
        LAST_POST_IMG: lastPostImg,
      });
    }
  } else {
    tpl.assignBlockVars("switch_no_topics", {});
  }

  return c.html(renderPage(tpl));
});

// AUTH_* levels: 0=ALL, 1=REG, 2=PRIVATE (group-based), 3=MOD, 4=ADMIN
function canDoAction(authLevel: number, user: any): boolean {
  if (authLevel === 0) return true;
  if (!user) return false;
  if (user.userLevel >= 1) return true; // admin can do everything
  if (authLevel === 1) return true; // registered user
  // For levels 2 (private/group), 3 (mod), 4 (admin) — simplified: deny unless admin
  return false;
}

function buildAuthList(forum: any, user: any): string {
  const lines: string[] = [];
  const can = (yes: boolean) => yes ? "<b>can</b>" : "<b>cannot</b>";

  const canPost = canDoAction(forum.auth_post ?? 1, user);
  const canReply = canDoAction(forum.auth_reply ?? 1, user);
  const canEdit = canDoAction(forum.auth_edit ?? 1, user);
  const canDelete = canDoAction(forum.auth_delete ?? 1, user);
  const canVote = canDoAction(forum.auth_vote ?? 1, user);

  lines.push(`You ${can(canPost)} post new topics in this forum`);
  lines.push(`You ${can(canReply)} reply to topics in this forum`);
  lines.push(`You ${can(canEdit)} edit your posts in this forum`);
  lines.push(`You ${can(canDelete)} delete your posts in this forum`);
  lines.push(`You ${can(canVote)} vote in polls in this forum`);

  if (user?.userLevel >= 1) {
    lines.push(`You ${can(true)} <a href="/modcp?f=${forum.id}">moderate this forum</a>`);
  }

  return lines.join("<br />");
}

export default viewforum;
