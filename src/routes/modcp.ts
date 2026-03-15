import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { createPageTemplate, renderPage, formatPhpBBDate } from "../lib/render.js";
import { parseBBCode } from "../lib/bbcode.js";

const modcp = new Hono();

function isMod(user: any): boolean {
  return user && user.userLevel >= 1; // 1=admin, 2=mod
}

function getAdminDb() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ─── ModCP Main Page ──────────────────────────────────────────
// GET /modcp?f=<forumId> — list topics for moderation

modcp.get("/modcp", async (c) => {
  const user = c.get("user");
  if (!isMod(user)) return c.text("Forbidden", 403);

  const forumId = parseInt(c.req.query("f") ?? "0", 10);
  if (!forumId) return c.text("Forum not specified", 400);

  const supabase = c.get("supabase");

  const { data: forum } = await supabase
    .from("forums")
    .select("id, forum_name")
    .eq("id", forumId)
    .single();

  if (!forum) return c.text("Forum not found", 404);

  const { data: topics } = await supabase
    .from("topics")
    .select("id, topic_title, topic_replies, topic_last_post_id, topic_status, topic_type")
    .eq("forum_id", forumId)
    .order("topic_last_post_id", { ascending: false })
    .limit(50);

  const tpl = createPageTemplate({
    user: user
      ? { id: user.id, username: user.username, unreadPms: user.unreadPms }
      : null,
    pageTitle: "Moderator Control Panel",
  });

  tpl.loadFile("body", "modcp_body.tpl");

  tpl.assignVars({
    FORUM_NAME: forum.forum_name,
    U_VIEW_FORUM: `/viewforum/${forumId}`,
    U_INDEX: "/",
    L_INDEX: "Index",
    L_MOD_CP: "Moderator Control Panel",
    L_MOD_CP_EXPLAIN: "From this panel you can perform mass moderation operations on this forum.",
    L_TOPICS: "Topics",
    L_REPLIES: "Replies",
    L_LASTPOST: "Last Post",
    L_SELECT: "Select",
    L_DELETE: "Delete",
    L_MOVE: "Move",
    L_LOCK: "Lock",
    L_UNLOCK: "Unlock",
    S_MODCP_ACTION: "/modcp",
    S_HIDDEN_FIELDS: `<input type="hidden" name="f" value="${forumId}" />`,
    PAGINATION: "",
    PAGE_NUMBER: "Page 1 of 1",
    S_TIMEZONE: "All times are GMT",
    JUMPBOX: "",
  });

  if (topics) {
    for (const topic of topics) {
      const folderImg =
        topic.topic_status === 1
          ? "templates/Solaris/images/folder_locked.gif"
          : "templates/Solaris/images/folder.gif";

      let topicType = "";
      if (topic.topic_type === 1) topicType = '<b class="gensmall">Sticky: </b>';
      if (topic.topic_type === 2) topicType = '<b class="gensmall">Announcement: </b>';

      tpl.assignBlockVars("topicrow", {
        TOPIC_ID: String(topic.id),
        TOPIC_TITLE: topic.topic_title,
        TOPIC_TYPE: topicType,
        TOPIC_FOLDER_IMG: folderImg,
        L_TOPIC_FOLDER_ALT: topic.topic_status === 1 ? "Locked" : "No new posts",
        REPLIES: String(topic.topic_replies ?? 0),
        LAST_POST_TIME: "",
        U_VIEW_TOPIC: `/viewtopic/${topic.id}`,
      });
    }
  }

  return c.html(renderPage(tpl));
});

// ─── ModCP Actions (POST) ─────────────────────────────────────

modcp.post("/modcp", async (c) => {
  const user = c.get("user");
  if (!isMod(user)) return c.text("Forbidden", 403);

  const body = await c.req.parseBody();
  const forumId = parseInt(body.f as string, 10);

  // Get selected topic IDs
  const topicIds: number[] = [];
  for (const [key, val] of Object.entries(body)) {
    if (key === "topic_id_list[]" || key === "topic_id_list") {
      if (Array.isArray(val)) {
        topicIds.push(...val.map((v: any) => parseInt(v, 10)));
      } else {
        topicIds.push(parseInt(val as string, 10));
      }
    }
  }

  // Handle move confirm/cancel from the move page
  if (body.confirm && body.mode === "move") {
    return handleMoveConfirm(c, user!, body, forumId);
  }

  // Handle split actions
  if (body.split_type_all || body.split_type_beyond) {
    return handleSplit(c, user!, body);
  }

  if (topicIds.length === 0) {
    return c.redirect(`/modcp?f=${forumId}`);
  }

  const adminDb = getAdminDb();

  if (body.delete) {
    // Delete selected topics
    for (const tid of topicIds) {
      await adminDb.from("topics").delete().eq("id", tid);
    }
    // Update forum post/topic counts
    await recalcForumStats(adminDb, forumId);
    return c.redirect(`/modcp?f=${forumId}`);
  }

  if (body.lock) {
    await adminDb
      .from("topics")
      .update({ topic_status: 1 })
      .in("id", topicIds);
    return c.redirect(`/modcp?f=${forumId}`);
  }

  if (body.unlock) {
    await adminDb
      .from("topics")
      .update({ topic_status: 0 })
      .in("id", topicIds);
    return c.redirect(`/modcp?f=${forumId}`);
  }

  if (body.move) {
    // Show move confirmation page
    return renderMovePage(c, user!, topicIds, forumId);
  }

  return c.redirect(`/modcp?f=${forumId}`);
});

// ─── Move Topic Page ──────────────────────────────────────────

async function renderMovePage(
  c: any,
  user: any,
  topicIds: number[],
  sourceForumId: number
) {
  const supabase = c.get("supabase");

  const { data: forums } = await supabase
    .from("forums")
    .select("id, forum_name, cat_id")
    .order("cat_id")
    .order("forum_order");

  let forumSelect = '<select name="new_forum_id">';
  if (forums) {
    for (const f of forums) {
      forumSelect += `<option value="${f.id}"${f.id === sourceForumId ? " selected" : ""}>${f.forum_name}</option>`;
    }
  }
  forumSelect += "</select>";

  const hiddenFields =
    topicIds.map((id) => `<input type="hidden" name="topic_id_list[]" value="${id}" />`).join("") +
    `<input type="hidden" name="f" value="${sourceForumId}" />` +
    `<input type="hidden" name="mode" value="move" />`;

  const tpl = createPageTemplate({
    user: { id: user.id, username: user.username, unreadPms: user.unreadPms },
    pageTitle: "Move Topic",
  });

  tpl.loadFile("body", "modcp_move.tpl");

  tpl.assignVars({
    U_INDEX: "/",
    L_INDEX: "Index",
    MESSAGE_TITLE: "Move Topic",
    MESSAGE_TEXT: `Moving ${topicIds.length} topic(s)`,
    L_MOVE_TO_FORUM: "Move to forum:",
    L_LEAVESHADOW: " Leave shadow topic",
    L_YES: "Yes",
    L_NO: "No",
    S_MODCP_ACTION: "/modcp",
    S_FORUM_SELECT: forumSelect,
    S_HIDDEN_FIELDS: hiddenFields,
  });

  return c.html(renderPage(tpl));
}

async function handleMoveConfirm(
  c: any,
  user: any,
  body: Record<string, any>,
  sourceForumId: number
) {
  if (body.cancel) {
    return c.redirect(`/modcp?f=${sourceForumId}`);
  }

  const newForumId = parseInt(body.new_forum_id as string, 10);
  if (!newForumId) return c.redirect(`/modcp?f=${sourceForumId}`);

  const topicIds: number[] = [];
  for (const [key, val] of Object.entries(body)) {
    if (key === "topic_id_list[]" || key === "topic_id_list") {
      if (Array.isArray(val)) {
        topicIds.push(...val.map((v: any) => parseInt(v, 10)));
      } else {
        topicIds.push(parseInt(val as string, 10));
      }
    }
  }

  const leaveShadow = !!body.move_leave_shadow;
  const adminDb = getAdminDb();

  for (const topicId of topicIds) {
    if (leaveShadow) {
      // Get original topic info for shadow
      const { data: original } = await adminDb
        .from("topics")
        .select("topic_title, topic_poster")
        .eq("id", topicId)
        .single();

      if (original) {
        // Create shadow topic pointing to the moved topic
        await adminDb.from("topics").insert({
          forum_id: sourceForumId,
          topic_title: original.topic_title,
          topic_poster: original.topic_poster,
          topic_status: 2, // moved
          topic_moved_id: topicId,
        });
      }
    }

    // Move topic to new forum
    await adminDb
      .from("topics")
      .update({ forum_id: newForumId })
      .eq("id", topicId);

    // Move all posts in this topic to the new forum
    await adminDb
      .from("posts")
      .update({ forum_id: newForumId })
      .eq("topic_id", topicId);
  }

  // Recalc stats for both forums
  await recalcForumStats(adminDb, sourceForumId);
  await recalcForumStats(adminDb, newForumId);

  return c.redirect(`/modcp?f=${newForumId}`);
}

// ─── Split Topic ──────────────────────────────────────────────

modcp.get("/modcp/split", async (c) => {
  const user = c.get("user");
  if (!isMod(user)) return c.text("Forbidden", 403);

  const topicId = parseInt(c.req.query("t") ?? "0", 10);
  if (!topicId) return c.text("Topic not specified", 400);

  const supabase = c.get("supabase");

  const { data: topic } = await supabase
    .from("topics")
    .select("*, forums(id, forum_name)")
    .eq("id", topicId)
    .single();

  if (!topic) return c.text("Topic not found", 404);

  const { data: posts } = await supabase
    .from("posts")
    .select(`
      *,
      poster:profiles!posts_poster_id_fkey(username),
      posts_text(post_subject, post_text)
    `)
    .eq("topic_id", topicId)
    .order("post_time", { ascending: true });

  const { data: forums } = await supabase
    .from("forums")
    .select("id, forum_name")
    .order("cat_id")
    .order("forum_order");

  let forumSelect = '<select name="new_forum_id">';
  if (forums) {
    for (const f of forums) {
      forumSelect += `<option value="${f.id}"${f.id === topic.forum_id ? " selected" : ""}>${f.forum_name}</option>`;
    }
  }
  forumSelect += "</select>";

  const tpl = createPageTemplate({
    user: { id: user.id, username: user.username, unreadPms: user.unreadPms },
    pageTitle: "Split Topic",
  });

  tpl.loadFile("body", "modcp_split.tpl");

  tpl.assignVars({
    U_INDEX: "/",
    L_INDEX: "Index",
    FORUM_NAME: topic.forums?.forum_name ?? "",
    U_VIEW_FORUM: `/viewforum/${topic.forum_id}`,
    L_SPLIT_TOPIC: "Split Topic",
    L_SPLIT_TOPIC_EXPLAIN:
      "Select the posts you wish to split into a new topic, or split after a selected post.",
    L_SPLIT_SUBJECT: "New topic subject:",
    L_SPLIT_FORUM: "New topic forum:",
    L_SPLIT_POSTS: "Split selected posts",
    L_SPLIT_AFTER: "Split from selected post",
    L_AUTHOR: "Author",
    L_MESSAGE: "Message",
    L_SELECT: "Select",
    L_POST: "Post",
    L_POSTED: "Posted:",
    L_POST_SUBJECT: "Post subject:",
    S_SPLIT_ACTION: "/modcp",
    S_FORUM_SELECT: forumSelect,
    S_HIDDEN_FIELDS: `<input type="hidden" name="topic_id" value="${topicId}" />`,
    S_TIMEZONE: "All times are GMT",
  });

  if (posts) {
    let rowIndex = 0;
    for (const post of posts) {
      const rowClass = rowIndex % 2 === 0 ? "row1" : "row2";
      tpl.assignBlockVars("postrow", {
        ROW_CLASS: rowClass,
        POSTER_NAME: post.poster?.username ?? "Guest",
        POST_DATE: formatPhpBBDate(post.post_time),
        POST_SUBJECT: post.posts_text?.post_subject ?? "",
        MESSAGE: parseBBCode(post.posts_text?.post_text ?? ""),
        U_POST_ID: String(post.id),
        S_SPLIT_CHECKBOX: `<input type="checkbox" name="post_id_list[]" value="${post.id}" class="checkbox" />`,
      });
      rowIndex++;
    }
  }

  return c.html(renderPage(tpl));
});

async function handleSplit(c: any, user: any, body: Record<string, any>) {
  const topicId = parseInt(body.topic_id as string, 10);
  const newForumId = parseInt(body.new_forum_id as string, 10);
  const newSubject = (body.subject as string) || "Split Topic";

  if (!topicId || !newForumId) return c.text("Invalid split request", 400);

  const adminDb = getAdminDb();

  // Get original topic
  const { data: originalTopic } = await adminDb
    .from("topics")
    .select("forum_id, topic_poster")
    .eq("id", topicId)
    .single();

  if (!originalTopic) return c.text("Topic not found", 404);

  // Determine which posts to split
  let postIdsToMove: number[] = [];

  if (body.split_type_all) {
    // Split selected posts
    for (const [key, val] of Object.entries(body)) {
      if (key === "post_id_list[]" || key === "post_id_list") {
        if (Array.isArray(val)) {
          postIdsToMove.push(...val.map((v: any) => parseInt(v, 10)));
        } else {
          postIdsToMove.push(parseInt(val as string, 10));
        }
      }
    }
  } else if (body.split_type_beyond) {
    // Split from selected post onward
    const selectedPostIds: number[] = [];
    for (const [key, val] of Object.entries(body)) {
      if (key === "post_id_list[]" || key === "post_id_list") {
        if (Array.isArray(val)) {
          selectedPostIds.push(...val.map((v: any) => parseInt(v, 10)));
        } else {
          selectedPostIds.push(parseInt(val as string, 10));
        }
      }
    }

    if (selectedPostIds.length > 0) {
      const splitPoint = Math.min(...selectedPostIds);
      // Get all posts from the split point onward
      const { data: postsAfter } = await adminDb
        .from("posts")
        .select("id")
        .eq("topic_id", topicId)
        .gte("id", splitPoint)
        .order("id");
      if (postsAfter) {
        postIdsToMove = postsAfter.map((p) => p.id);
      }
    }
  }

  if (postIdsToMove.length === 0) {
    return c.redirect(`/modcp/split?t=${topicId}`);
  }

  // Create new topic
  const { data: newTopic } = await adminDb
    .from("topics")
    .insert({
      forum_id: newForumId,
      topic_title: newSubject,
      topic_poster: originalTopic.topic_poster,
    })
    .select()
    .single();

  if (!newTopic) return c.text("Failed to create split topic", 500);

  // Move posts to new topic
  await adminDb
    .from("posts")
    .update({ topic_id: newTopic.id, forum_id: newForumId })
    .in("id", postIdsToMove);

  // Update new topic's first/last post
  const { data: newFirstPost } = await adminDb
    .from("posts")
    .select("id")
    .eq("topic_id", newTopic.id)
    .order("post_time", { ascending: true })
    .limit(1)
    .single();

  const { data: newLastPost } = await adminDb
    .from("posts")
    .select("id")
    .eq("topic_id", newTopic.id)
    .order("post_time", { ascending: false })
    .limit(1)
    .single();

  const { count: newPostCount } = await adminDb
    .from("posts")
    .select("*", { count: "exact", head: true })
    .eq("topic_id", newTopic.id);

  await adminDb
    .from("topics")
    .update({
      topic_first_post_id: newFirstPost?.id,
      topic_last_post_id: newLastPost?.id,
      topic_replies: (newPostCount ?? 1) - 1,
    })
    .eq("id", newTopic.id);

  // Update original topic's first/last post
  const { data: origFirstPost } = await adminDb
    .from("posts")
    .select("id")
    .eq("topic_id", topicId)
    .order("post_time", { ascending: true })
    .limit(1)
    .single();

  const { data: origLastPost } = await adminDb
    .from("posts")
    .select("id")
    .eq("topic_id", topicId)
    .order("post_time", { ascending: false })
    .limit(1)
    .single();

  const { count: origPostCount } = await adminDb
    .from("posts")
    .select("*", { count: "exact", head: true })
    .eq("topic_id", topicId);

  if (origFirstPost) {
    await adminDb
      .from("topics")
      .update({
        topic_first_post_id: origFirstPost.id,
        topic_last_post_id: origLastPost?.id,
        topic_replies: (origPostCount ?? 1) - 1,
      })
      .eq("id", topicId);
  } else {
    // All posts were moved — delete the original topic
    await adminDb.from("topics").delete().eq("id", topicId);
  }

  // Recalc forum stats
  await recalcForumStats(adminDb, originalTopic.forum_id);
  if (newForumId !== originalTopic.forum_id) {
    await recalcForumStats(adminDb, newForumId);
  }

  return c.redirect(`/viewtopic/${newTopic.id}`);
}

// ─── View IP ──────────────────────────────────────────────────

modcp.get("/modcp/ip", async (c) => {
  const user = c.get("user");
  if (!isMod(user)) return c.text("Forbidden", 403);

  const postId = parseInt(c.req.query("p") ?? "0", 10);
  if (!postId) return c.text("Post not specified", 400);

  const adminDb = getAdminDb();

  // Get the post's IP
  const { data: post } = await adminDb
    .from("posts")
    .select("id, poster_id, poster_ip, topic_id")
    .eq("id", postId)
    .single();

  if (!post) return c.text("Post not found", 404);

  const ip = post.poster_ip ?? "Unknown";

  // Count posts from this IP
  const { count: ipPostCount } = await adminDb
    .from("posts")
    .select("*", { count: "exact", head: true })
    .eq("poster_ip", ip);

  // Find other users who posted from this IP
  const { data: otherUsers } = await adminDb
    .from("posts")
    .select("poster_id, profiles!posts_poster_id_fkey(id, username)")
    .eq("poster_ip", ip)
    .neq("poster_id", post.poster_id)
    .limit(50);

  // Deduplicate users
  const seenUsers = new Set<string>();
  const uniqueUsers: { id: string; username: string; postCount?: number }[] = [];
  if (otherUsers) {
    for (const u of otherUsers) {
      const profile = u.profiles as any;
      if (profile && !seenUsers.has(profile.id)) {
        seenUsers.add(profile.id);
        const { count } = await adminDb
          .from("posts")
          .select("*", { count: "exact", head: true })
          .eq("poster_id", profile.id)
          .eq("poster_ip", ip);
        uniqueUsers.push({
          id: profile.id,
          username: profile.username,
          postCount: count ?? 0,
        });
      }
    }
  }

  // Find other IPs used by this poster
  const { data: otherIps } = await adminDb
    .from("posts")
    .select("poster_ip")
    .eq("poster_id", post.poster_id)
    .neq("poster_ip", ip)
    .limit(50);

  const seenIps = new Set<string>();
  const uniqueIps: { ip: string; postCount?: number }[] = [];
  if (otherIps) {
    for (const p of otherIps) {
      const pIp = p.poster_ip;
      if (pIp && !seenIps.has(pIp)) {
        seenIps.add(pIp);
        const { count } = await adminDb
          .from("posts")
          .select("*", { count: "exact", head: true })
          .eq("poster_id", post.poster_id)
          .eq("poster_ip", pIp);
        uniqueIps.push({ ip: pIp, postCount: count ?? 0 });
      }
    }
  }

  const tpl = createPageTemplate({
    user: { id: user.id, username: user.username, unreadPms: user.unreadPms },
    pageTitle: "IP Information",
  });

  tpl.loadFile("body", "modcp_viewip.tpl");

  tpl.assignVars({
    U_INDEX: "/",
    L_INDEX: "Index",
    L_IP_INFO: "IP Information",
    L_THIS_POST_IP: "IP Address for this post",
    IP: String(ip),
    POSTS: `${ipPostCount ?? 0} posts`,
    U_LOOKUP_IP: `https://whatismyipaddress.com/ip/${ip}`,
    L_LOOKUP_IP: "Lookup IP Address",
    L_OTHER_USERS: "Other users who have posted from this IP",
    L_OTHER_IPS: "Other IPs used by this poster",
    L_SEARCH: "Search",
    SEARCH_IMG: "templates/Solaris/images/lang_english/icon_search.gif",
  });

  let rowIndex = 0;
  for (const u of uniqueUsers) {
    tpl.assignBlockVars("userrow", {
      ROW_CLASS: rowIndex % 2 === 0 ? "row1" : "row2",
      USERNAME: u.username,
      U_PROFILE: `/profile/${u.id}`,
      POSTS: `${u.postCount} posts from this IP`,
      U_SEARCHPOSTS: `/search?search_author=${encodeURIComponent(u.username)}&show_results=posts`,
      L_SEARCH_POSTS: "Search posts by this user",
    });
    rowIndex++;
  }

  rowIndex = 0;
  for (const ipEntry of uniqueIps) {
    tpl.assignBlockVars("iprow", {
      ROW_CLASS: rowIndex % 2 === 0 ? "row1" : "row2",
      IP: ipEntry.ip,
      POSTS: `${ipEntry.postCount} posts`,
      U_LOOKUP_IP: `https://whatismyipaddress.com/ip/${ipEntry.ip}`,
    });
    rowIndex++;
  }

  return c.html(renderPage(tpl));
});

// ─── Helpers ──────────────────────────────────────────────────

async function recalcForumStats(adminDb: any, forumId: number) {
  const { count: topicCount } = await adminDb
    .from("topics")
    .select("*", { count: "exact", head: true })
    .eq("forum_id", forumId)
    .neq("topic_status", 2); // exclude shadow/moved

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

export default modcp;
