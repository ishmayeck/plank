import { Hono } from "hono";
import { createPageTemplate, renderPage, renderErrorBox, formatPhpBBDate, fetchAndRenderJumpbox, renderMessagePage } from "../lib/render.js";
import { getSupabaseAdmin } from "../db/client.js";
import { parseBBCode } from "../lib/bbcode.js";
import { loadSmilies, replaceSmilies, type Smiley } from "../lib/smilies.js";
import { isModOrAdmin } from "../lib/userLevel.js";
import { Template } from "../template/engine.js";
import { join } from "node:path";
import { loginRedirect } from "./auth.js";

const THEME_DIR = join(import.meta.dirname, "..", "..", "themes", "Solaris");

const posting = new Hono();

// ─── GET: Show posting form ────────────────────────────────────

posting.get("/posting", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect(loginRedirect(c));
  const mode = c.req.query("mode") ?? "newtopic";
  const supabase = c.get("supabase");

  let forumId: number | null = null;
  let topicId: number | null = null;
  let postId: number | null = null;
  let subject = "";
  let message = "";
  let forumName = "";
  let postTitle = "Post a new topic";
  let currentTopicType = 0;
  let isFirstPost = false;

  if (mode === "newtopic") {
    forumId = parseInt(c.req.query("f") ?? "0", 10);
    isFirstPost = true;
    const { data: forum } = await supabase
      .from("forums")
      .select("forum_name")
      .eq("id", forumId)
      .single();
    forumName = forum?.forum_name ?? "";
  } else if (mode === "reply") {
    topicId = parseInt(c.req.query("t") ?? "0", 10);
    const { data: topic } = await supabase
      .from("topics")
      .select("*, forums(forum_name)")
      .eq("id", topicId)
      .single();
    if (!topic) return c.text("Topic not found", 404);
    forumId = topic.forum_id;
    forumName = topic.forums?.forum_name ?? "";
    subject = `Re: ${topic.topic_title}`;
    postTitle = "Post a reply";
  } else if (mode === "quote") {
    postId = parseInt(c.req.query("p") ?? "0", 10);
    const { data: post } = await supabase
      .from("posts")
      .select("*, posts_text(*), poster:profiles!posts_poster_id_fkey(username), topics!posts_topic_id_fkey(topic_title, forum_id, forums(forum_name))")
      .eq("id", postId)
      .single();
    if (!post) return c.text("Post not found", 404);
    topicId = post.topic_id;
    forumId = post.topics?.forum_id ?? 0;
    forumName = post.topics?.forums?.forum_name ?? "";
    subject = `Re: ${post.topics?.topic_title ?? ""}`;
    message = `[quote="${post.poster?.username ?? "Guest"}"]${post.posts_text?.post_text ?? ""}[/quote]\n`;
    postTitle = "Post a reply";
  } else if (mode === "editpost") {
    postId = parseInt(c.req.query("p") ?? "0", 10);
    const { data: post } = await supabase
      .from("posts")
      .select("*, posts_text(*), topics!posts_topic_id_fkey(id, topic_title, topic_type, topic_first_post_id, forum_id, forums(forum_name))")
      .eq("id", postId)
      .single();
    if (!post) return c.text("Post not found", 404);
    // Check permission: own post or mod/admin
    if (post.poster_id !== user.id && !isModOrAdmin(user)) {
      return c.text("Forbidden", 403);
    }
    topicId = post.topic_id;
    forumId = post.topics?.forum_id ?? 0;
    forumName = post.topics?.forums?.forum_name ?? "";
    subject = post.posts_text?.post_subject ?? "";
    message = post.posts_text?.post_text ?? "";
    postTitle = "Edit post";
    currentTopicType = post.topics?.topic_type ?? 0;
    isFirstPost = post.topics?.topic_first_post_id === post.id;
  } else if (mode === "delete") {
    postId = parseInt(c.req.query("p") ?? "0", 10);
    const { data: post } = await supabase
      .from("posts")
      .select("*, topics!posts_topic_id_fkey(forum_id)")
      .eq("id", postId)
      .single();
    if (!post) return c.text("Post not found", 404);
    if (post.poster_id !== user.id && !isModOrAdmin(user)) {
      return c.text("Forbidden", 403);
    }
    return c.html(renderConfirmPage({
      user,
      title: "Information",
      message: "Are you sure you want to delete this post?",
      action: "/posting",
      hiddenFields: { mode: "delete", post_id: String(postId) },
    }));
  }

  const smilies = await loadSmilies(supabase);
  const topicReviewHtml = topicId && (mode === "reply" || mode === "quote")
    ? await renderTopicReview(topicId, smilies, true)
    : "";
  const topicTypeToggle = (isFirstPost && isModOrAdmin(user))
    ? buildTopicTypeToggle(currentTopicType)
    : "";
  const jumpboxHtml = await fetchAndRenderJumpbox(supabase);
  const html = renderPostingForm({
    user,
    mode,
    forumId,
    topicId,
    postId,
    forumName,
    subject,
    message,
    postTitle,
    smilies,
    topicReviewHtml,
    topicTypeToggle,
    showPoll: mode === "newtopic",
    jumpboxHtml,
  });

  return c.html(html);
});

// ─── GET: Standalone topic review (loaded in iframe) ──────────

posting.get("/posting_topic_review", async (c) => {
  const topicId = parseInt(c.req.query("t") ?? "0", 10);
  if (!topicId) return c.text("Missing topic", 400);

  const supabase = c.get("supabase");
  const smilies = await loadSmilies(supabase);
  const reviewHtml = await renderTopicReview(topicId, smilies, false);

  // Use simple_header/simple_footer templates like phpBB2 does for iframe content
  const tpl = new Template(THEME_DIR);
  tpl.loadFile("header", "simple_header.tpl");
  tpl.loadFile("footer", "simple_footer.tpl");

  tpl.assignVars({
    S_CONTENT_DIRECTION: "ltr",
    S_CONTENT_ENCODING: "utf-8",
    SITENAME: "Plank Forum",
    PAGE_TITLE: "Topic Review",
    T_HEAD_STYLESHEET: "Solaris.css",
    META: '<base href="/">',
    T_BODY_BGCOLOR: "#E5E5E5",
    T_BODY_TEXT: "#000000",
    T_BODY_LINK: "#006699",
    T_BODY_VLINK: "#5493B4",
    PHPBB_VERSION: "2.0",
  });

  return c.html(tpl.render("header") + reviewHtml + tpl.render("footer"));
});

// ─── POST: Submit post ─────────────────────────────────────────

posting.post("/posting", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect(loginRedirect(c));
  const body = await c.req.parseBody();
  const mode = body.mode as string;
  const subject = (body.subject as string)?.trim() ?? "";
  const message = (body.message as string) ?? "";
  const forumId = parseInt(body.forum_id as string, 10) || 0;
  const topicId = parseInt(body.topic_id as string, 10) || 0;
  const postId = parseInt(body.post_id as string, 10) || 0;
  const enableSig = body.attach_sig === "on";
  const enableSmilies = body.disable_smilies !== "on";
  const enableBBCode = body.disable_bbcode !== "on";
  const topicType = isModOrAdmin(user) ? parseInt(body.topictype as string, 10) || 0 : 0;

  // Collect current poll options from form
  function collectPollOptions(): string[] {
    const opts: string[] = [];
    for (const [key, val] of Object.entries(body)) {
      const match = key.match(/^poll_option_text\[(\d+)\]$/);
      if (match) {
        opts[parseInt(match[1], 10)] = (val as string) ?? "";
      }
    }
    return opts.filter((_, i) => opts[i] !== undefined);
  }

  // Handle poll option add/delete (re-render form)
  if (body.add_poll_option || body.edit_poll_option || Object.keys(body).some(k => k.startsWith("del_poll_option"))) {
    const supabase = c.get("supabase");
    const smilies = await loadSmilies(supabase);
    const { data: forum } = await supabase.from("forums").select("forum_name").eq("id", forumId).single();
    let pollOpts = collectPollOptions();

    if (body.add_poll_option) {
      const newOpt = (body.add_poll_option_text as string)?.trim() ?? "";
      if (newOpt) pollOpts.push(newOpt);
      else pollOpts.push("");
    }

    // Delete option
    for (const key of Object.keys(body)) {
      const match = key.match(/^del_poll_option\[(\d+)\]$/);
      if (match) {
        const delIdx = parseInt(match[1], 10);
        pollOpts = pollOpts.filter((_, i) => i !== delIdx);
      }
    }

    if (pollOpts.length < 2) pollOpts = [...pollOpts, "", ""].slice(0, 2);

    const isFirst = mode === "newtopic";
    const topicTypeToggle = (isFirst && isModOrAdmin(user))
      ? buildTopicTypeToggle(topicType)
      : "";
    const reviewHtml = topicId && (mode === "reply" || mode === "quote") ? await renderTopicReview(topicId, smilies, true) : "";

    return c.html(renderPostingForm({
      user, mode, forumId, topicId, postId,
      forumName: forum?.forum_name ?? "", subject, message,
      postTitle: mode === "newtopic" ? "Post a new topic" : mode === "editpost" ? "Edit post" : "Post a reply",
      smilies, topicReviewHtml: reviewHtml, topicTypeToggle,
      showPoll: mode === "newtopic",
      pollTitle: (body.poll_title as string) ?? "",
      pollOptions: pollOpts,
      pollLength: parseInt(body.poll_length as string, 10) || 0,
      jumpboxHtml: await fetchAndRenderJumpbox(supabase),
    }));
  }

  // Preview mode
  if (body.preview) {
    const supabase = c.get("supabase");
    const smilies = await loadSmilies(supabase);
    const { data: forum } = await supabase
      .from("forums")
      .select("forum_name")
      .eq("id", forumId)
      .single();

    const previewHtml = parseBBCode(message);
    const reviewHtml = topicId && (mode === "reply" || mode === "quote") ? await renderTopicReview(topicId, smilies, true) : "";

    const html = renderPostingForm({
      user,
      mode,
      forumId,
      topicId,
      postId,
      forumName: forum?.forum_name ?? "",
      subject,
      message,
      postTitle: mode === "newtopic" ? "Post a new topic" : mode === "editpost" ? "Edit post" : "Post a reply",
      smilies,
      preview: previewHtml,
      topicReviewHtml: reviewHtml,
      showPoll: mode === "newtopic",
      pollTitle: (body.poll_title as string) ?? "",
      pollOptions: collectPollOptions(),
      pollLength: parseInt(body.poll_length as string, 10) || 0,
      jumpboxHtml: await fetchAndRenderJumpbox(supabase),
    });
    return c.html(html);
  }

  // Validation (skip for delete mode)
  if (mode !== "delete" && !message.trim()) {
    const supabase = c.get("supabase");
    const smilies = await loadSmilies(supabase);
    const { data: forum } = await supabase.from("forums").select("forum_name").eq("id", forumId).single();
    const reviewHtml = topicId && (mode === "reply" || mode === "quote") ? await renderTopicReview(topicId, smilies, true) : "";
    return c.html(renderPostingForm({
      user, mode, forumId, topicId, postId,
      forumName: forum?.forum_name ?? "", subject, message,
      postTitle: mode === "newtopic" ? "Post a new topic" : mode === "editpost" ? "Edit post" : "Post a reply",
      smilies, error: "You must enter a message when posting.", topicReviewHtml: reviewHtml,
      jumpboxHtml: await fetchAndRenderJumpbox(supabase),
    }));
  }

  const adminDb = getSupabaseAdmin();

  // Pre-render BBCode to HTML
  const messageHtml = enableBBCode ? parseBBCode(message) : message;

  if (mode === "newtopic") {
    if (!subject.trim()) {
      const supabase = c.get("supabase");
      const smilies = await loadSmilies(supabase);
      const { data: forum } = await supabase.from("forums").select("forum_name").eq("id", forumId).single();
      return c.html(renderPostingForm({
        user, mode, forumId, topicId, postId,
        forumName: forum?.forum_name ?? "", subject, message,
        postTitle: "Post a new topic",
        smilies, error: "Subject must not be empty.",
        jumpboxHtml: await fetchAndRenderJumpbox(supabase),
      }));
    }

    // Validate poll: if a title is given, need at least 2 options
    const pollTitleCheck = (body.poll_title as string)?.trim() ?? "";
    if (pollTitleCheck) {
      const optCount = Object.entries(body).filter(
        ([k, v]) => k.match(/^poll_option_text\[\d+\]$/) && (v as string).trim()
      ).length + ((body.add_poll_option_text as string)?.trim() ? 1 : 0);
      if (optCount < 2) {
        const supabase = c.get("supabase");
        const smilies = await loadSmilies(supabase);
        const { data: forum } = await supabase.from("forums").select("forum_name").eq("id", forumId).single();
        const pollOpts: string[] = [];
        for (const [k, v] of Object.entries(body)) {
          if (k.match(/^poll_option_text\[\d+\]$/)) pollOpts.push((v as string) ?? "");
        }
        return c.html(renderPostingForm({
          user, mode, forumId, topicId, postId,
          forumName: forum?.forum_name ?? "", subject, message,
          postTitle: "Post a new topic",
          smilies, error: "You must enter at least two poll options.",
          topicTypeToggle: isModOrAdmin(user) ? buildTopicTypeToggle(topicType) : undefined,
          showPoll: true, pollTitle: pollTitleCheck, pollOptions: pollOpts,
          pollLength: parseInt(body.poll_length as string, 10) || 0,
          jumpboxHtml: await fetchAndRenderJumpbox(supabase),
        }));
      }
    }

    // Create topic
    const { data: topic, error: topicErr } = await adminDb
      .from("topics")
      .insert({
        forum_id: forumId,
        topic_title: subject,
        topic_poster: user.id,
        topic_type: topicType,
      })
      .select()
      .single();

    if (topicErr || !topic) return c.text("Failed to create topic", 500);

    // Create post
    const { data: post, error: postErr } = await adminDb
      .from("posts")
      .insert({
        topic_id: topic.id,
        forum_id: forumId,
        poster_id: user.id,
        poster_ip: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? null,
        enable_bbcode: enableBBCode,
        enable_smilies: enableSmilies,
        enable_sig: enableSig,
      })
      .select()
      .single();

    if (postErr || !post) return c.text("Failed to create post", 500);

    // Create post text
    await adminDb.from("posts_text").insert({
      post_id: post.id,
      post_subject: subject,
      post_text: message,
      post_text_html: messageHtml,
    });

    // Update topic first/last post
    await adminDb
      .from("topics")
      .update({
        topic_first_post_id: post.id,
        topic_last_post_id: post.id,
      })
      .eq("id", topic.id);

    // Update forum last post and increment stats
    const { data: currentForum } = await adminDb
      .from("forums")
      .select("forum_posts, forum_topics")
      .eq("id", forumId)
      .single();

    await adminDb
      .from("forums")
      .update({
        forum_posts: (currentForum?.forum_posts ?? 0) + 1,
        forum_topics: (currentForum?.forum_topics ?? 0) + 1,
        forum_last_post_id: post.id,
      })
      .eq("id", forumId);

    // Update user post count
    await adminDb
      .from("profiles")
      .update({ user_posts: (await adminDb.from("posts").select("id", { count: "exact", head: true }).eq("poster_id", user.id)).count ?? 0 })
      .eq("id", user.id);

    // Create poll if poll title and options provided
    const pollTitle = (body.poll_title as string)?.trim() ?? "";
    const pollOptionTexts: string[] = [];
    for (const [key, val] of Object.entries(body)) {
      const match = key.match(/^poll_option_text\[(\d+)\]$/);
      if (match && (val as string).trim()) {
        pollOptionTexts.push((val as string).trim());
      }
    }
    // Also check add_poll_option_text
    const addPollOption = (body.add_poll_option_text as string)?.trim() ?? "";
    if (addPollOption) pollOptionTexts.push(addPollOption);

    if (pollTitle && pollOptionTexts.length >= 2) {
      const pollLengthDays = parseInt(body.poll_length as string, 10) || 0;
      const { data: poll } = await adminDb
        .from("poll_questions")
        .insert({
          topic_id: topic.id,
          poll_text: pollTitle,
          poll_length: pollLengthDays > 0 ? `${pollLengthDays} days` : null,
        })
        .select()
        .single();

      if (poll) {
        for (let i = 0; i < pollOptionTexts.length; i++) {
          await adminDb.from("poll_options").insert({
            poll_id: poll.id,
            option_text: pollOptionTexts[i],
            option_order: i,
          });
        }
        await adminDb.from("topics").update({ topic_vote: true }).eq("id", topic.id);
      }
    }

    const viewUrl = `/viewtopic/${topic.id}`;
    return c.html(renderMessagePage({
      ctx: { user: { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel } },
      title: "Information",
      messageHtml:
        'Your message has been entered successfully.<br /><br />' +
        `Click <a href="${viewUrl}">Here</a> to view your message<br /><br />` +
        `Click <a href="/viewforum/${forumId}">Here</a> to return to the forum`,
      redirectUrl: viewUrl,
    }));

  } else if (mode === "reply" || mode === "quote") {
    // Create reply post
    const { data: post, error: postErr } = await adminDb
      .from("posts")
      .insert({
        topic_id: topicId,
        forum_id: forumId,
        poster_id: user.id,
        poster_ip: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? null,
        enable_bbcode: enableBBCode,
        enable_smilies: enableSmilies,
        enable_sig: enableSig,
      })
      .select()
      .single();

    if (postErr || !post) return c.text("Failed to create post", 500);

    await adminDb.from("posts_text").insert({
      post_id: post.id,
      post_subject: subject || `Re: `,
      post_text: message,
      post_text_html: messageHtml,
    });

    // Update topic last post and reply count
    const { count: replyCount } = await adminDb
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("topic_id", topicId);

    await adminDb
      .from("topics")
      .update({
        topic_last_post_id: post.id,
        topic_replies: (replyCount ?? 1) - 1,
      })
      .eq("id", topicId);

    // Update forum last post and increment post count
    const { data: currentForum } = await adminDb
      .from("forums")
      .select("forum_posts")
      .eq("id", forumId)
      .single();

    await adminDb
      .from("forums")
      .update({
        forum_last_post_id: post.id,
        forum_posts: (currentForum?.forum_posts ?? 0) + 1,
      })
      .eq("id", forumId);

    // Update user post count
    const { count: userPosts } = await adminDb
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("poster_id", user.id);

    await adminDb
      .from("profiles")
      .update({ user_posts: userPosts ?? 0 })
      .eq("id", user.id);

    const postsPerPage = 15;
    const totalPages = Math.ceil((replyCount ?? 1) / postsPerPage);
    const viewUrl = totalPages > 1
      ? `/viewtopic/${topicId}?page=${totalPages}#${post.id}`
      : `/viewtopic/${topicId}#${post.id}`;

    return c.html(renderMessagePage({
      ctx: { user: { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel } },
      title: "Information",
      messageHtml:
        'Your message has been entered successfully.<br /><br />' +
        `Click <a href="${viewUrl}">Here</a> to view your message<br /><br />` +
        `Click <a href="/viewforum/${forumId}">Here</a> to return to the forum`,
      redirectUrl: viewUrl,
    }));

  } else if (mode === "editpost") {
    // Verify permission
    const { data: existingPost } = await adminDb
      .from("posts")
      .select("poster_id")
      .eq("id", postId)
      .single();

    if (!existingPost) return c.text("Post not found", 404);
    if (existingPost.poster_id !== user.id && !isModOrAdmin(user)) {
      return c.text("Forbidden", 403);
    }

    // Update post metadata
    // Get current edit count to increment
    const { data: currentPost } = await adminDb
      .from("posts")
      .select("post_edit_count")
      .eq("id", postId)
      .single();

    await adminDb
      .from("posts")
      .update({
        enable_bbcode: enableBBCode,
        enable_smilies: enableSmilies,
        enable_sig: enableSig,
        post_edit_time: new Date().toISOString(),
        post_edit_count: (currentPost?.post_edit_count ?? 0) + 1,
      })
      .eq("id", postId);

    // Update post text
    await adminDb.from("posts_text").update({
      post_subject: subject,
      post_text: message,
      post_text_html: messageHtml,
    }).eq("post_id", postId);

    // Update topic type if editing first post and user is admin
    if (topicType !== undefined && isModOrAdmin(user)) {
      const { data: editedPost } = await adminDb
        .from("posts")
        .select("topic_id, topics!posts_topic_id_fkey(topic_first_post_id)")
        .eq("id", postId)
        .single();
      if (editedPost?.topics?.topic_first_post_id === postId) {
        await adminDb.from("topics").update({ topic_type: topicType }).eq("id", editedPost.topic_id);
      }
    }

    // Find the topic for redirect
    const { data: post } = await adminDb
      .from("posts")
      .select("topic_id")
      .eq("id", postId)
      .single();

    const editViewUrl = `/viewtopic/${post?.topic_id ?? topicId}#${postId}`;
    return c.html(renderMessagePage({
      ctx: { user: { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel } },
      title: "Information",
      messageHtml:
        'Your message has been entered successfully.<br /><br />' +
        `Click <a href="${editViewUrl}">Here</a> to view your message<br /><br />` +
        `Click <a href="/viewforum/${forumId}">Here</a> to return to the forum`,
      redirectUrl: editViewUrl,
    }));

  } else if (mode === "delete") {
    const deletePostId = parseInt(c.req.query("p") ?? body.post_id as string, 10);
    const { data: post } = await adminDb
      .from("posts")
      .select("*, topics!posts_topic_id_fkey(topic_first_post_id, forum_id)")
      .eq("id", deletePostId)
      .single();

    if (!post) return c.text("Post not found", 404);
    if (post.poster_id !== user.id && !isModOrAdmin(user)) {
      return c.text("Forbidden", 403);
    }

    // Cancel → go back to the topic
    if (body.cancel) {
      return c.redirect(`/viewtopic/${post.topic_id}`);
    }

    // Must confirm before deleting
    if (!body.confirm) {
      return c.html(renderConfirmPage({
        user,
        title: "Information",
        message: "Are you sure you want to delete this post?",
        action: "/posting",
        hiddenFields: { mode: "delete", post_id: String(deletePostId) },
      }));
    }

    const isFirstPost = post.topics?.topic_first_post_id === deletePostId;
    const redirectForumId = post.topics?.forum_id ?? post.forum_id;

    const userCtx = { user: { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel } };

    if (isFirstPost) {
      // Delete entire topic (cascade deletes posts)
      await adminDb.from("topics").delete().eq("id", post.topic_id);
      const forumUrl = `/viewforum/${redirectForumId}`;
      return c.html(renderMessagePage({
        ctx: userCtx,
        title: "Information",
        messageHtml:
          'Your message has been deleted successfully.<br /><br />' +
          `Click <a href="${forumUrl}">Here</a> to return to the forum`,
        redirectUrl: forumUrl,
      }));
    } else {
      // Delete just this post
      await adminDb.from("posts").delete().eq("id", deletePostId);

      // Update topic reply count
      const { count: newCount } = await adminDb
        .from("posts")
        .select("*", { count: "exact", head: true })
        .eq("topic_id", post.topic_id);

      // Get new last post
      const { data: lastPost } = await adminDb
        .from("posts")
        .select("id")
        .eq("topic_id", post.topic_id)
        .order("post_time", { ascending: false })
        .limit(1)
        .single();

      await adminDb
        .from("topics")
        .update({
          topic_replies: (newCount ?? 1) - 1,
          topic_last_post_id: lastPost?.id ?? null,
        })
        .eq("id", post.topic_id);

      const topicUrl = `/viewtopic/${post.topic_id}`;
      const forumUrl = `/viewforum/${redirectForumId}`;
      return c.html(renderMessagePage({
        ctx: userCtx,
        title: "Information",
        messageHtml:
          'Your message has been deleted successfully.<br /><br />' +
          `Click <a href="${topicUrl}">Here</a> to return to the topic<br /><br />` +
          `Click <a href="${forumUrl}">Here</a> to return to the forum`,
        redirectUrl: topicUrl,
      }));
    }
  }

  return c.text("Invalid mode", 400);
});

// ─── Rendering Helper ──────────────────────────────────────────

interface PostingFormOpts {
  user: { id: string; username: string; unreadPms: number; userLevel: number; userSig: string; attachSig: boolean };
  mode: string;
  forumId: number | null;
  topicId: number | null;
  postId: number | null;
  forumName: string;
  subject: string;
  message: string;
  postTitle: string;
  smilies: Smiley[];
  preview?: string;
  error?: string;
  topicReviewHtml?: string;
  topicTypeToggle?: string;
  pollTitle?: string;
  pollOptions?: string[];
  pollLength?: number;
  showPoll?: boolean;
  jumpboxHtml?: string;
}

function renderPostingForm(opts: PostingFormOpts): string {
  const tpl = createPageTemplate({
    user: { id: opts.user.id, username: opts.user.username, unreadPms: opts.user.unreadPms, userLevel: opts.user.userLevel },
    pageTitle: opts.postTitle,
  });

  tpl.loadFile("body", "posting_body.tpl");

  // Build hidden fields
  const hiddenFields = [
    `<input type="hidden" name="mode" value="${opts.mode}" />`,
    opts.forumId ? `<input type="hidden" name="forum_id" value="${opts.forumId}" />` : "",
    opts.topicId ? `<input type="hidden" name="topic_id" value="${opts.topicId}" />` : "",
    opts.postId ? `<input type="hidden" name="post_id" value="${opts.postId}" />` : "",
  ].join("");

  // Preview box
  const previewBox = opts.preview
    ? `<table width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td class="tableborder"><table width="100%" cellpadding="4" cellspacing="1" border="0"><tr><th class="thHead">Preview</th></tr><tr><td class="row1"><span class="postbody">${opts.preview}</span></td></tr></table></td></tr></table><br />`
    : "";

  tpl.assignVars({
    S_POST_ACTION: "/posting",
    POST_PREVIEW_BOX: previewBox,
    ERROR_BOX: opts.error ? renderErrorBox(opts.error) : "",
    U_INDEX: "/",
    L_INDEX: "Index",
    U_VIEW_FORUM: opts.forumId ? `/viewforum/${opts.forumId}` : "/",
    FORUM_NAME: opts.forumName,
    L_POST_A: opts.postTitle,
    L_SUBJECT: "Subject",
    L_MESSAGE_BODY: "Message body",
    L_EMOTICONS: "Emoticons",
    L_OPTIONS: "Options",
    L_PREVIEW: "Preview",
    L_SUBMIT: "Submit",
    L_EMPTY_MESSAGE: "You must enter a message when posting.",
    S_HIDDEN_FORM_FIELDS: hiddenFields,
    SUBJECT: opts.subject,
    MESSAGE: opts.message,
    S_TIMEZONE: "All times are GMT",
    JUMPBOX: opts.jumpboxHtml ?? "",
    TOPIC_REVIEW_BOX: opts.topicReviewHtml ?? "",
    POLLBOX: opts.showPoll ? renderPollBox(opts.pollTitle ?? "", opts.pollOptions ?? [""], opts.pollLength ?? 0) : "",
    S_SMILIES_COLSPAN: "4",

    // BBCode toolbar labels
    L_BBCODE_B_HELP: "Bold text: [b]text[/b]  (alt+b)",
    L_BBCODE_I_HELP: "Italic text: [i]text[/i]  (alt+i)",
    L_BBCODE_U_HELP: "Underline text: [u]text[/u]  (alt+u)",
    L_BBCODE_Q_HELP: "Quote text: [quote]text[/quote]  (alt+q)",
    L_BBCODE_C_HELP: "Code display: [code]code[/code]  (alt+c)",
    L_BBCODE_L_HELP: "List: [list]text[/list] (alt+l)",
    L_BBCODE_O_HELP: "Ordered list: [list=]text[/list]  (alt+o)",
    L_BBCODE_P_HELP: "Insert image: [img]http://image_url[/img]  (alt+p)",
    L_BBCODE_W_HELP: "Insert URL: [url]http://url[/url] or [url=http://url]URL text[/url]  (alt+w)",
    L_BBCODE_A_HELP: "Close all open bbCode tags",
    L_BBCODE_S_HELP: "Font color: [color=red]text[/color]  Tip: you can also use color=#FF0000",
    L_BBCODE_F_HELP: "Font size: [size=x-small]small text[/size]",
    L_FONT_COLOR: "Font colour",
    L_FONT_SIZE: "Font size",
    L_BBCODE_CLOSE_TAGS: "Close Tags",
    L_STYLES_TIP: "Tip: Styles can be applied quickly to selected text.",

    // Color options
    L_COLOR_DEFAULT: "Default",
    L_COLOR_DARK_RED: "Dark Red",
    L_COLOR_RED: "Red",
    L_COLOR_ORANGE: "Orange",
    L_COLOR_BROWN: "Brown",
    L_COLOR_YELLOW: "Yellow",
    L_COLOR_GREEN: "Green",
    L_COLOR_OLIVE: "Olive",
    L_COLOR_CYAN: "Cyan",
    L_COLOR_BLUE: "Blue",
    L_COLOR_DARK_BLUE: "Dark Blue",
    L_COLOR_INDIGO: "Indigo",
    L_COLOR_VIOLET: "Violet",
    L_COLOR_WHITE: "White",
    L_COLOR_BLACK: "Black",

    // Font size options
    L_FONT_TINY: "Tiny",
    L_FONT_SMALL: "Small",
    L_FONT_NORMAL: "Normal",
    L_FONT_LARGE: "Large",
    L_FONT_HUGE: "Huge",

    // Checkbox options
    HTML_STATUS: "HTML is OFF",
    BBCODE_STATUS: '<a href="/faq" target="_phpbbcode">BBCode</a> is <u>ON</u>',
    SMILIES_STATUS: "Smilies are ON",
    L_DISABLE_HTML: "Disable HTML in this post",
    L_DISABLE_BBCODE: "Disable BBCode in this post",
    L_DISABLE_SMILIES: "Disable Smilies in this post",
    L_ATTACH_SIGNATURE: "Attach signature (signatures can be changed in profile)",
    L_NOTIFY_ON_REPLY: "Notify me when a reply is posted",
    L_DELETE_POST: "Delete this post",
    S_HTML_CHECKED: "",
    S_BBCODE_CHECKED: "",
    S_SMILIES_CHECKED: "",
    S_SIGNATURE_CHECKED: opts.user.userSig && opts.user.attachSig ? 'checked="checked"' : "",
    S_NOTIFY_CHECKED: "",
    S_TYPE_TOGGLE: opts.topicTypeToggle ?? "",

    L_USERNAME: "Username",
    USERNAME: opts.user.username,
    L_FIND_USERNAME: "Find a username",
    U_SEARCH_USER: "/search?mode=user",

    U_MORE_SMILIES: "/posting_smilies",
    L_MORE_SMILIES: "View more Emoticons",
  });

  // Switches for the posting form
  tpl.assignBlockVars("switch_not_privmsg", {});
  tpl.assignBlockVars("switch_bbcode_checkbox", {});
  tpl.assignBlockVars("switch_smilies_checkbox", {});
  if (opts.user.userSig) {
    tpl.assignBlockVars("switch_signature_checkbox", {});
  }
  tpl.assignBlockVars("switch_notify_checkbox", {});

  if (opts.mode === "editpost") {
    tpl.assignBlockVars("switch_delete_checkbox", {});
  }

  if (opts.topicTypeToggle) {
    tpl.assignBlockVars("switch_type_toggle", {});
  }

  // Smilies grid (show first 19 in a 4-column grid, matching phpBB2)
  const smiliesPerRow = 4;
  const displaySmilies = opts.smilies.slice(0, 19);
  for (let row = 0; row < Math.ceil(displaySmilies.length / smiliesPerRow); row++) {
    tpl.assignBlockVars("smilies_row", {});
    for (let col = 0; col < smiliesPerRow; col++) {
      const idx = row * smiliesPerRow + col;
      if (idx < displaySmilies.length) {
        const smiley = displaySmilies[idx];
        tpl.assignBlockVars("smilies_row.smilies_col", {
          SMILEY_CODE: smiley.code.replace(/'/g, "\\'"),
          SMILEY_IMG: `images/smiles/${smiley.smile_url}`,
          SMILEY_DESC: smiley.emoticon,
        });
      }
    }
  }

  if (displaySmilies.length < opts.smilies.length) {
    tpl.assignBlockVars("switch_smilies_extra", {});
  }

  return renderPage(tpl);
}

function renderPollBox(pollTitle: string, pollOptions: string[], pollLength: number): string {
  const tpl = new Template(THEME_DIR);
  tpl.loadFile("pollbox", "posting_poll_body.tpl");

  tpl.assignVars({
    L_ADD_A_POLL: "Add a Poll",
    L_ADD_POLL_EXPLAIN: "If you do not want to add a poll to your topic, leave the fields blank",
    L_POLL_QUESTION: "Poll question",
    POLL_TITLE: pollTitle,
    L_POLL_OPTION: "Poll option",
    L_ADD_OPTION: "Add option",
    L_UPDATE_OPTION: "Update",
    L_DELETE_OPTION: "Delete",
    L_POLL_LENGTH: "Run poll for",
    POLL_LENGTH: String(pollLength || ""),
    L_DAYS: "Days",
    L_POLL_LENGTH_EXPLAIN: "Leave as 0 for a never ending poll",
    L_POLL_DELETE: "Delete poll",
    ADD_POLL_OPTION: "",
  });

  for (let i = 0; i < pollOptions.length; i++) {
    tpl.assignBlockVars("poll_option_rows", {
      S_POLL_OPTION_NUM: String(i),
      POLL_OPTION: pollOptions[i],
    });
  }

  return tpl.render("pollbox");
}

function buildTopicTypeToggle(currentType: number = 0): string {
  const normalChecked = currentType === 0 ? ' checked="checked"' : "";
  const stickyChecked = currentType === 1 ? ' checked="checked"' : "";
  const announceChecked = currentType === 2 ? ' checked="checked"' : "";

  return `Post topic as: ` +
    `<input type="radio" name="topictype" value="0"${normalChecked} /> Normal&nbsp;&nbsp;` +
    `<input type="radio" name="topictype" value="1"${stickyChecked} /> Sticky&nbsp;&nbsp;` +
    `<input type="radio" name="topictype" value="2"${announceChecked} /> Announcement`;
}

async function renderTopicReview(topicId: number, smilies: Smiley[], inline: boolean): Promise<string> {
  const adminDb = getSupabaseAdmin();

  const { data: posts } = await adminDb
    .from("posts")
    .select("id, post_time, poster_id, posts_text(post_subject, post_text), profiles(username)")
    .eq("topic_id", topicId)
    .order("post_time", { ascending: false })
    .limit(15);

  if (!posts || posts.length === 0) return "";

  const tpl = new Template(THEME_DIR);
  tpl.loadFile("review", "posting_topic_review.tpl");

  tpl.assignVars({
    L_TOPIC_REVIEW: "Topic Review",
    U_REVIEW_TOPIC: `/posting_topic_review?t=${topicId}`,
    L_AUTHOR: "Author",
    L_MESSAGE: "Message",
    L_POSTED: "Posted",
    L_POST_SUBJECT: "Post subject",
  });

  if (inline) {
    tpl.assignBlockVars("switch_inline_mode", {});
  }

  let rowIndex = 0;
  for (const post of posts) {
    const postText = post.posts_text as any;
    const poster = post.profiles as any;
    let messageHtml = parseBBCode(postText?.post_text ?? "");
    messageHtml = replaceSmilies(messageHtml, smilies);

    tpl.assignBlockVars("postrow", {
      ROW_CLASS: rowIndex % 2 === 0 ? "row1" : "row2",
      POSTER_NAME: poster?.username ?? "Guest",
      U_POST_ID: String(post.id),
      MINI_POST_IMG: "templates/Solaris/images/icon_minipost.gif",
      L_MINI_POST_ALT: "Post",
      POST_DATE: formatPhpBBDate(post.post_time),
      POST_SUBJECT: postText?.post_subject ?? "",
      MESSAGE: messageHtml,
    });
    rowIndex++;
  }

  return tpl.render("review");
}

interface ConfirmPageOpts {
  user: { id: string; username: string; unreadPms: number; userLevel: number };
  title: string;
  message: string;
  action: string;
  hiddenFields: Record<string, string>;
}

function renderConfirmPage(opts: ConfirmPageOpts): string {
  const tpl = createPageTemplate({
    user: {
      id: opts.user.id,
      username: opts.user.username,
      unreadPms: opts.user.unreadPms,
      userLevel: opts.user.userLevel,
    },
    pageTitle: opts.title,
  });

  tpl.loadFile("body", "confirm_body.tpl");

  let hiddenHtml = "";
  for (const [key, val] of Object.entries(opts.hiddenFields)) {
    hiddenHtml += `<input type="hidden" name="${key}" value="${val}" />`;
  }

  tpl.assignVars({
    MESSAGE_TITLE: opts.title,
    MESSAGE_TEXT: opts.message,
    L_YES: "Yes",
    L_NO: "No",
    S_CONFIRM_ACTION: opts.action,
    S_HIDDEN_FIELDS: hiddenHtml,
    U_INDEX: "/",
    L_INDEX: "Index",
  });

  return renderPage(tpl);
}

export default posting;
