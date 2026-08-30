import { Hono } from "hono";
import { createPageTemplate, renderPage, formatPhpBBDate, fetchAndRenderJumpbox } from "../lib/render.js";
import { generatePagination } from "../lib/pagination.js";
import { parseBBCode } from "../lib/bbcode.js";
import { loadSmilies, replaceSmilies } from "../lib/smilies.js";
import { loadWordCensors, applyCensors } from "../lib/wordcensor.js";
import { escapeHtml } from "../lib/escape.js";
import { safeExternalUrl } from "../lib/url.js";
import { markup } from "../lib/markup.js";
import { renderPollForTopic } from "./poll.js";
import { getCsrfToken } from "../lib/csrf.js";
import { loadUserGroupAcls, canDo, canMod } from "../lib/permissions.js";
import { getSupabaseAdmin } from "../db/client.js";

const POSTS_PER_PAGE = 15;

const viewtopic = new Hono();

viewtopic.get("/viewtopic/:id", async (c) => {
  const topicId = parseInt(c.req.param("id"), 10);
  const page = parseInt(c.req.query("page") ?? "1", 10);
  const user = c.get("user");
  const supabase = getSupabaseAdmin();

  // Fetch topic with forum info, including auth_* gates we need to
  // evaluate before rendering anything.
  const { data: topic, error: topicError } = await supabase
    .from("topics")
    .select(
      // forums(*) — not a column subset. This page asks canDo() about
      // reply/post/edit/delete as well as view/read, and canDo now throws
      // on a column the select didn't fetch rather than defaulting open.
      "*, forums(*)"
    )
    .eq("id", topicId)
    .maybeSingle();

  if (topicError || !topic) {
    return c.text("Topic not found", 404);
  }

  // Shadow/moved topic — redirect to the real topic
  if (topic.topic_status === 2 && topic.topic_moved_id) {
    return c.redirect(`/viewtopic/${topic.topic_moved_id}`);
  }

  // Per-forum ACL gate. auth_view denial mirrors a 404 (no leakage);
  // auth_read denial is a 403 because the forum is visible but its
  // content isn't.
  const userAcls = await loadUserGroupAcls(supabase, user);
  const parentForum = (topic as any).forums ?? { id: topic.forum_id };
  if (!canDo("view", parentForum, user, userAcls)) {
    return c.text("Topic not found", 404);
  }
  if (!canDo("read", parentForum, user, userAcls)) {
    return c.text("You do not have permission to read posts in this forum.", 403);
  }

  // Increment view count atomically and fetch jumpbox data in parallel
  const [, jumpboxHtml] = await Promise.all([
    supabase.rpc("increment_topic_views", { p_topic_id: topicId }),
    fetchAndRenderJumpbox(supabase, topic.forum_id, { user, acls: userAcls }),
  ]);

  const tpl = createPageTemplate({
    user: user
      ? { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel }
      : null,
    pageTitle: topic.topic_title,
  });

  tpl.loadFile("body", "viewtopic_body.tpl");

  // Get post count for pagination
  const { count: totalPosts } = await supabase
    .from("posts")
    .select("*", { count: "exact", head: true })
    .eq("topic_id", topicId);

  const offset = (page - 1) * POSTS_PER_PAGE;

  // Fetch posts with author profile and text
  const { data: posts } = await supabase
    .from("posts")
    .select(
      `
      *,
      poster:profiles!posts_poster_id_fkey(
        id, username, user_avatar, user_sig, user_posts,
        user_regdate, user_from, user_rank, user_level
      ),
      posts_text(post_subject, post_text)
    `
    )
    .eq("topic_id", topicId)
    .order("post_time", { ascending: true })
    .range(offset, offset + POSTS_PER_PAGE - 1);

  // Load smilies and word censors
  const smilies = await loadSmilies(supabase);
  const censors = await loadWordCensors(supabase);

  // Load ranks for display
  const { data: ranks } = await supabase.from("ranks").select("*");

  const pagination = generatePagination(
    `/viewtopic/${topicId}`,
    totalPosts ?? 0,
    POSTS_PER_PAGE,
    page
  );

  // Get prev/next topic IDs
  // First/last topic in a forum has no neighbour — 0 rows is normal.
  const { data: prevTopic } = await supabase
    .from("topics")
    .select("id")
    .eq("forum_id", topic.forum_id)
    .lt("topic_last_post_id", topic.topic_last_post_id ?? 0)
    .order("topic_last_post_id", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: nextTopic } = await supabase
    .from("topics")
    .select("id")
    .eq("forum_id", topic.forum_id)
    .gt("topic_last_post_id", topic.topic_last_post_id ?? 0)
    .order("topic_last_post_id", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Render poll if topic has one
  const showViewResults = c.req.query("poll_results") === "1";
  const pollHtml = await renderPollForTopic(
    topicId,
    user?.id ?? null,
    showViewResults,
    getCsrfToken(c)
  );

  const isLocked = topic.topic_status === 1;
  // Per-forum permission checks. canReply / canPost reflect what the
  // viewer can actually do on this specific forum — they drive the
  // "Reply" / "New topic" buttons in the topic header.
  const canReply = !isLocked && canDo("reply", parentForum, user, userAcls);
  const canPost = canDo("post", parentForum, user, userAcls);
  // Per-forum mod: drives the lock/move/split/delete topic-admin
  // toolbar and the edit/delete buttons on other users' posts.
  const isTopicMod = canMod(topic.forum_id, user, userAcls);

  // Build topic moderation controls for moderators/admins
  let topicAdminHtml = markup("");
  if (isTopicMod) {
    const lockImg = isLocked
      ? `<a href="/modcp?mode=unlock&t=${topicId}&f=${topic.forum_id}"><img src="templates/Solaris/images/topic_unlock.gif" alt="Unlock Topic" title="Unlock Topic" border="0" /></a>`
      : `<a href="/modcp?mode=lock&t=${topicId}&f=${topic.forum_id}"><img src="templates/Solaris/images/topic_lock.gif" alt="Lock Topic" title="Lock Topic" border="0" /></a>`;
    topicAdminHtml = markup(
      `<a href="/modcp?mode=delete&t=${topicId}&f=${topic.forum_id}"><img src="templates/Solaris/images/topic_delete.gif" alt="Delete Topic" title="Delete Topic" border="0" /></a>&nbsp;` +
      `<a href="/modcp?mode=move&t=${topicId}&f=${topic.forum_id}"><img src="templates/Solaris/images/topic_move.gif" alt="Move Topic" title="Move Topic" border="0" /></a>&nbsp;` +
      `${lockImg}&nbsp;` +
      `<a href="/modcp?mode=split&t=${topicId}&f=${topic.forum_id}"><img src="templates/Solaris/images/topic_split.gif" alt="Split Topic" title="Split Topic" border="0" /></a>`
    );
  }

  tpl.assignVars({
    TOPIC_TITLE: applyCensors(topic.topic_title, censors),
    U_VIEW_TOPIC: `/viewtopic/${topicId}`,
    FORUM_NAME: topic.forums?.forum_name ?? "",
    U_VIEW_FORUM: `/viewforum/${topic.forum_id}`,
    U_INDEX: "/",
    L_INDEX: "Index",

    // Post/reply buttons
    POST_IMG: "templates/Solaris/images/lang_english/new_topic.gif",
    REPLY_IMG: isLocked
      ? "templates/Solaris/images/lang_english/locked.gif"
      : "templates/Solaris/images/lang_english/post_reply.gif",
    L_POST_NEW_TOPIC: "Post new topic",
    L_POST_REPLY_TOPIC: isLocked ? "Topic is locked" : "Post reply",
    U_POST_NEW_TOPIC: `/posting?mode=newtopic&f=${topic.forum_id}`,
    U_POST_REPLY_TOPIC: canReply
      ? `/posting?mode=reply&t=${topicId}`
      : isLocked
        ? "#"
        : `/login?redirect=${encodeURIComponent(`/posting?mode=reply&t=${topicId}`)}`,

    // Navigation
    L_VIEW_PREVIOUS_TOPIC: "View previous topic",
    L_VIEW_NEXT_TOPIC: "View next topic",
    U_VIEW_OLDER_TOPIC: prevTopic ? `/viewtopic/${prevTopic.id}` : "#",
    U_VIEW_NEWER_TOPIC: nextTopic ? `/viewtopic/${nextTopic.id}` : "#",

    // Labels
    L_AUTHOR: "Author",
    L_MESSAGE: "Message",
    L_POSTED: "Posted",
    L_POST_SUBJECT: "Post subject",
    L_BACK_TO_TOP: "Back to top",
    L_DISPLAY_POSTS: "Display posts from previous",
    L_GO: "Go",

    // Pagination
    PAGINATION: pagination.html,
    PAGE_NUMBER: pagination.pageNumber,
    S_TIMEZONE: "All times are GMT",

    // Post display form
    S_POST_DAYS_ACTION: `/viewtopic/${topicId}`,
    S_SELECT_POST_DAYS: markup(
      '<select name="postdays"><option value="0" selected>All Posts</option><option value="1">1 Day</option><option value="7">7 Days</option></select>'
    ),
    S_SELECT_POST_ORDER: markup(
      '<select name="postorder"><option value="asc" selected>Oldest First</option><option value="desc">Newest First</option></select>'
    ),

    // Topic admin
    S_WATCH_TOPIC: "",
    S_TOPIC_ADMIN: topicAdminHtml,
    S_AUTH_LIST: "",
    JUMPBOX: jumpboxHtml,
    POLL_DISPLAY: pollHtml,
  });

  // Populate post rows
  if (posts) {
    let rowIndex = 0;
    for (const post of posts) {
      const postText = post.posts_text;
      const poster = post.poster;
      const rowClass = rowIndex % 2 === 0 ? "row1" : "row2";

      // Render post content: always parse from BBCode source
      let messageHtml = postText?.post_text ? parseBBCode(postText.post_text) : markup("");

      // Apply smilies and word censoring to rendered HTML
      if (post.enable_smilies) {
        messageHtml = replaceSmilies(messageHtml, smilies);
      }
      messageHtml = applyCensors(messageHtml, censors);

      // Signature
      let signature = markup("");
      if (post.enable_sig && poster?.user_sig) {
        signature = markup(`<br />_________________<br />${parseBBCode(poster.user_sig).html}`);
      }

      // Rank
      const rank = getRank(poster?.user_posts ?? 0, poster?.user_rank ?? 0, ranks ?? []);

      // Avatar
      const posterAvatar = safeExternalUrl(poster?.user_avatar);
      const avatar = posterAvatar
        ? markup(`<br /><img src="${escapeHtml(posterAvatar)}" alt="" /><br />`)
        : markup("");

      // Action buttons (based on permissions). The edit/delete icons
      // appear when either: the viewer is the post author and has the
      // per-forum auth_edit / auth_delete bit, or they have mod
      // authority over this forum.
      const isOwnPost = user && poster?.id === user.id;
      const canEditButton =
        (isOwnPost && canDo("edit", parentForum, user, userAcls)) || isTopicMod;
      const canDeleteButton =
        (isOwnPost && canDo("delete", parentForum, user, userAcls)) || isTopicMod;

      const quoteImg = user && !isLocked && canReply
        ? markup(`<a href="/posting?mode=quote&p=${post.id}"><img src="templates/Solaris/images/lang_english/icon_quote.gif" alt="Reply with quote" border="0" /></a>`)
        : markup("");
      const editImg = canEditButton
        ? markup(`<a href="/posting?mode=editpost&p=${post.id}"><img src="templates/Solaris/images/lang_english/icon_edit.gif" alt="Edit" border="0" /></a>`)
        : markup("");
      const deleteImg = canDeleteButton
        ? markup(`<a href="/posting?mode=delete&p=${post.id}"><img src="templates/Solaris/images/icon_delete.gif" alt="Delete" border="0" /></a>`)
        : markup("");

      tpl.assignBlockVars("postrow", {
        ROW_CLASS: rowClass,
        POSTER_NAME: poster?.username ?? post.post_username ?? "Guest",
        POSTER_RANK: rank.title,
        RANK_IMAGE: rank.image
          ? markup(`<img src="${escapeHtml(rank.image)}" alt="${escapeHtml(rank.title)}" /><br />`)
          : markup(""),
        POSTER_AVATAR: avatar,
        POSTER_JOINED: `Joined: ${formatPhpBBDate(poster?.user_regdate ?? post.post_time, true)}`,
        POSTER_POSTS: `Posts: ${poster?.user_posts ?? 0}`,
        POSTER_FROM: poster?.user_from ? `Location: ${poster.user_from}` : "",
        U_POST_ID: String(post.id),
        U_MINI_POST: `/viewtopic/${topicId}#${post.id}`,
        MINI_POST_IMG: "templates/Solaris/images/icon_minipost.gif",
        L_MINI_POST_ALT: "Post",
        POST_DATE: formatPhpBBDate(post.post_time),
        POST_SUBJECT: applyCensors(postText?.post_subject ?? "", censors),
        MESSAGE: messageHtml,
        SIGNATURE: signature,
        EDITED_MESSAGE: post.post_edit_count > 0
          ? markup(`<br /><br />Last edited by ${escapeHtml(poster?.username ?? "Unknown")} on ${formatPhpBBDate(post.post_edit_time)}; edited ${post.post_edit_count} time${post.post_edit_count > 1 ? "s" : ""} in total`)
          : markup(""),
        QUOTE_IMG: quoteImg,
        EDIT_IMG: editImg,
        DELETE_IMG: deleteImg,
        IP_IMG: isTopicMod
          ? markup(`<a href="/modcp/ip?p=${post.id}"><img src="templates/Solaris/images/lang_english/icon_ip.gif" alt="IP" border="0" /></a>`)
          : markup(""),
        PROFILE_IMG: markup(`<a href="/profile/${encodeURIComponent(poster?.id ?? "")}"><img src="templates/Solaris/images/lang_english/icon_profile.gif" alt="Profile" border="0" /></a>`),
        PM_IMG: poster
          ? markup(`<a href="/privmsg?mode=post&u=${encodeURIComponent(poster.id)}"><img src="templates/Solaris/images/lang_english/icon_pm.gif" alt="PM" border="0" /></a>`)
          : markup(""),
        EMAIL_IMG: "",
        WWW_IMG: poster?.user_from
          ? ""
          : "",
        AIM_IMG: "",
        YIM_IMG: "",
        MSN_IMG: "",
        ICQ_IMG: "",
      });

      rowIndex++;
    }
  }

  return c.html(renderPage(tpl));
});

function getRank(
  postCount: number,
  userRank: number,
  ranks: any[]
): { title: string; image: string | null } {
  // Special ranks (manually assigned) take priority
  if (userRank > 0) {
    const special = ranks.find((r: any) => r.id === userRank && r.rank_special);
    if (special) return { title: special.rank_title, image: special.rank_image };
  }

  // Auto-rank by post count (highest qualifying rank)
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

export default viewtopic;
