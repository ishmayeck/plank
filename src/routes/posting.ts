import { Hono } from "hono";
import { createPageTemplate, renderPage, renderErrorBox, formatPhpBBDate, fetchAndRenderJumpbox, renderMessagePage } from "../lib/render.js";
import { getSupabaseAdmin } from "../db/client.js";
import { parseBBCode } from "../lib/bbcode.js";
import { loadSmilies, replaceSmilies, type Smiley } from "../lib/smilies.js";
import { isModOrAdmin } from "../lib/userLevel.js";
import { loadUserGroupAcls, canDo, canMod, type ForumAclMap } from "../lib/permissions.js";
import { escapeHtml } from "../lib/escape.js";
import { markup, type MarkupString } from "../lib/markup.js";
import { formHiddenFields } from "../lib/csrf.js";
import {
  POSTING_BBCODE_LABELS,
  POSTING_COLOR_LABELS,
  POSTING_FONT_SIZE_LABELS,
} from "../lib/labels.js";
import { createTemplate } from "../template/source.js";
import { checkRateLimit, RATE_LIMITS, retryAfterText } from "../lib/rate_limit.js";
import { loginRedirect } from "./auth.js";
import type { Context } from "hono";

const posting = new Hono();

// ─── GET: Show posting form ────────────────────────────────────

posting.get("/posting", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect(loginRedirect(c));
  const mode = c.req.query("mode") ?? "newtopic";
  const supabase = c.get("supabase");

  const userAcls = await loadUserGroupAcls(supabase, user);

  let forumId: number | null = null;
  let topicId: number | null = null;
  let postId: number | null = null;
  let subject = "";
  let message = "";
  let forumName = "";
  let postTitle = "Post a new topic";
  let currentTopicType = 0;
  let isFirstPost = false;
  let forumRow: any = null;

  if (mode === "newtopic") {
    forumId = parseInt(c.req.query("f") ?? "0", 10);
    isFirstPost = true;
    const { data: forum } = await supabase
      .from("forums")
      .select("*")
      .eq("id", forumId)
      .maybeSingle();
    if (!forum) return c.text("Forum not found", 404);
    if (!canDo("view", forum, user, userAcls)) return c.text("Forum not found", 404);
    if (!canDo("read", forum, user, userAcls)) return c.text("You do not have permission to read this forum.", 403);
    if (!canDo("post", forum, user, userAcls)) return c.text("You do not have permission to post new topics in this forum.", 403);
    forumRow = forum;
    forumName = forum.forum_name ?? "";
  } else if (mode === "reply") {
    topicId = parseInt(c.req.query("t") ?? "0", 10);
    const { data: topic } = await supabase
      .from("topics")
      .select("*, forums(*)")
      .eq("id", topicId)
      .maybeSingle();
    if (!topic) return c.text("Topic not found", 404);
    const f = (topic as any).forums;
    if (!canDo("view", f, user, userAcls)) return c.text("Topic not found", 404);
    if (!canDo("read", f, user, userAcls)) return c.text("You do not have permission to read this forum.", 403);
    if (!canDo("reply", f, user, userAcls)) return c.text("You do not have permission to reply in this forum.", 403);
    if (topic.topic_status === 1 && !canMod(f.id, user, userAcls)) {
      return c.text("This topic is locked.", 403);
    }
    forumRow = f;
    forumId = topic.forum_id;
    forumName = f?.forum_name ?? "";
    subject = `Re: ${topic.topic_title}`;
    postTitle = "Post a reply";
  } else if (mode === "quote") {
    postId = parseInt(c.req.query("p") ?? "0", 10);
    const { data: post } = await supabase
      .from("posts")
      .select("*, posts_text(*), poster:profiles!posts_poster_id_fkey(username), topics!posts_topic_id_fkey(topic_title, topic_status, forum_id, forums(*))")
      .eq("id", postId)
      .maybeSingle();
    if (!post) return c.text("Post not found", 404);
    const f = (post as any).topics?.forums;
    if (!f) return c.text("Post not found", 404);
    if (!canDo("view", f, user, userAcls)) return c.text("Post not found", 404);
    if (!canDo("read", f, user, userAcls)) return c.text("You do not have permission to read this forum.", 403);
    if (!canDo("reply", f, user, userAcls)) return c.text("You do not have permission to reply in this forum.", 403);
    if ((post as any).topics?.topic_status === 1 && !canMod(f.id, user, userAcls)) {
      return c.text("This topic is locked.", 403);
    }
    forumRow = f;
    topicId = post.topic_id;
    forumId = (post as any).topics?.forum_id ?? 0;
    forumName = f?.forum_name ?? "";
    subject = `Re: ${(post as any).topics?.topic_title ?? ""}`;
    message = `[quote="${(post as any).poster?.username ?? "Guest"}"]${(post as any).posts_text?.post_text ?? ""}[/quote]\n`;
    postTitle = "Post a reply";
  } else if (mode === "editpost") {
    postId = parseInt(c.req.query("p") ?? "0", 10);
    const { data: post } = await supabase
      .from("posts")
      .select("*, posts_text(*), topics!posts_topic_id_fkey(id, topic_title, topic_type, topic_status, topic_first_post_id, forum_id, forums(*))")
      .eq("id", postId)
      .maybeSingle();
    if (!post) return c.text("Post not found", 404);
    const f = (post as any).topics?.forums;
    if (!f) return c.text("Post not found", 404);
    if (!canDo("view", f, user, userAcls)) return c.text("Post not found", 404);
    if (!canDo("read", f, user, userAcls)) return c.text("You do not have permission to read this forum.", 403);
    // Own post + auth_edit, OR per-forum mod (which covers global mod/admin).
    if (post.poster_id === user.id) {
      if (!canDo("edit", f, user, userAcls)) {
        return c.text("You do not have permission to edit posts in this forum.", 403);
      }
    } else if (!canMod(f.id, user, userAcls)) {
      return c.text("You cannot edit another user's post.", 403);
    }
    forumRow = f;
    topicId = post.topic_id;
    forumId = (post as any).topics?.forum_id ?? 0;
    forumName = f?.forum_name ?? "";
    subject = (post as any).posts_text?.post_subject ?? "";
    message = (post as any).posts_text?.post_text ?? "";
    postTitle = "Edit post";
    currentTopicType = (post as any).topics?.topic_type ?? 0;
    isFirstPost = (post as any).topics?.topic_first_post_id === post.id;
  } else if (mode === "delete") {
    postId = parseInt(c.req.query("p") ?? "0", 10);
    const { data: post } = await supabase
      .from("posts")
      .select("*, topics!posts_topic_id_fkey(forum_id, forums(*))")
      .eq("id", postId)
      .maybeSingle();
    if (!post) return c.text("Post not found", 404);
    const f = (post as any).topics?.forums;
    if (!f) return c.text("Post not found", 404);
    if (!canDo("view", f, user, userAcls)) return c.text("Post not found", 404);
    if (post.poster_id === user.id) {
      if (!canDo("delete", f, user, userAcls)) {
        return c.text("You do not have permission to delete posts in this forum.", 403);
      }
    } else if (!canMod(f.id, user, userAcls)) {
      return c.text("You cannot delete another user's post.", 403);
    }
    return c.html(renderConfirmPage({
      c,
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
  const jumpboxHtml = await fetchAndRenderJumpbox(supabase, undefined, { user });
  const html = renderPostingForm({
    c,
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
  const tpl = createTemplate();
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
  const requestedTopicType = parseInt(body.topictype as string, 10) || 0;

  const supabaseForAcl = c.get("supabase");
  const userAcls = await loadUserGroupAcls(supabaseForAcl, user);

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
    const { data: forum } = await supabase.from("forums").select("forum_name").eq("id", forumId).maybeSingle();
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
      ? buildTopicTypeToggle(requestedTopicType)
      : "";
    const reviewHtml = topicId && (mode === "reply" || mode === "quote") ? await renderTopicReview(topicId, smilies, true) : "";

    return c.html(renderPostingForm({
      c,
      user, mode, forumId, topicId, postId,
      forumName: forum?.forum_name ?? "", subject, message,
      postTitle: mode === "newtopic" ? "Post a new topic" : mode === "editpost" ? "Edit post" : "Post a reply",
      smilies, topicReviewHtml: reviewHtml, topicTypeToggle,
      showPoll: mode === "newtopic",
      pollTitle: (body.poll_title as string) ?? "",
      pollOptions: pollOpts,
      pollLength: parseInt(body.poll_length as string, 10) || 0,
      jumpboxHtml: await fetchAndRenderJumpbox(supabase, undefined, { user }),
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
      .maybeSingle();

    const previewHtml = parseBBCode(message);
    const reviewHtml = topicId && (mode === "reply" || mode === "quote") ? await renderTopicReview(topicId, smilies, true) : "";

    const html = renderPostingForm({
      c,
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
      jumpboxHtml: await fetchAndRenderJumpbox(supabase, undefined, { user }),
    });
    return c.html(html);
  }

  // Validation (skip for delete mode)
  if (mode !== "delete" && !message.trim()) {
    const supabase = c.get("supabase");
    const smilies = await loadSmilies(supabase);
    const { data: forum } = await supabase.from("forums").select("forum_name").eq("id", forumId).maybeSingle();
    const reviewHtml = topicId && (mode === "reply" || mode === "quote") ? await renderTopicReview(topicId, smilies, true) : "";
    return c.html(renderPostingForm({
      c,
      user, mode, forumId, topicId, postId,
      forumName: forum?.forum_name ?? "", subject, message,
      postTitle: mode === "newtopic" ? "Post a new topic" : mode === "editpost" ? "Edit post" : "Post a reply",
      smilies, error: "You must enter a message when posting.", topicReviewHtml: reviewHtml,
      jumpboxHtml: await fetchAndRenderJumpbox(supabase, undefined, { user }),
    }));
  }

  const adminDb = getSupabaseAdmin();

  // Pre-render BBCode to HTML
  const messageHtml = enableBBCode ? parseBBCode(message) : message;

  if (mode === "newtopic") {
    // Re-check permissions at submit time — the form may have been
    // open while group membership changed.
    const supabase = c.get("supabase");
    const { data: forum } = await supabase
      .from("forums")
      .select("*")
      .eq("id", forumId)
      .maybeSingle();
    if (!forum) return c.text("Forum not found", 404);
    if (!canDo("view", forum, user, userAcls)) return c.text("Forum not found", 404);
    if (!canDo("post", forum, user, userAcls)) {
      return c.text("You do not have permission to post new topics in this forum.", 403);
    }

    // sticky/announce/global topic types each have their own gate.
    // Silently downgrade rather than rejecting outright (matches
    // phpBB2's behaviour: ignore disallowed flags, keep the post).
    let topicType = 0;
    if (requestedTopicType === 1 && canDo("sticky", forum, user, userAcls)) topicType = 1;
    else if (requestedTopicType === 2 && canDo("announce", forum, user, userAcls)) topicType = 2;
    else if (requestedTopicType === 3 && user.userLevel === 1 /* USER_LEVEL.ADMIN */) topicType = 3;

    if (!subject.trim()) {
      const smilies = await loadSmilies(supabase);
      return c.html(renderPostingForm({
        c,
        user, mode, forumId, topicId, postId,
        forumName: forum?.forum_name ?? "", subject, message,
        postTitle: "Post a new topic",
        smilies, error: "Subject must not be empty.",
        jumpboxHtml: await fetchAndRenderJumpbox(supabase, undefined, { user }),
      }));
    }

    // Validate poll: if a title is given, need at least 2 options
    const pollTitleCheck = (body.poll_title as string)?.trim() ?? "";
    if (pollTitleCheck) {
      const optCount = Object.entries(body).filter(
        ([k, v]) => k.match(/^poll_option_text\[\d+\]$/) && (v as string).trim()
      ).length + ((body.add_poll_option_text as string)?.trim() ? 1 : 0);
      if (optCount < 2) {
        const smilies = await loadSmilies(supabase);
        const pollOpts: string[] = [];
        for (const [k, v] of Object.entries(body)) {
          if (k.match(/^poll_option_text\[\d+\]$/)) pollOpts.push((v as string) ?? "");
        }
        return c.html(renderPostingForm({
          c,
          user, mode, forumId, topicId, postId,
          forumName: forum?.forum_name ?? "", subject, message,
          postTitle: "Post a new topic",
          smilies, error: "You must enter at least two poll options.",
          topicTypeToggle: isModOrAdmin(user) ? buildTopicTypeToggle(requestedTopicType) : undefined,
          showPoll: true, pollTitle: pollTitleCheck, pollOptions: pollOpts,
          pollLength: parseInt(body.poll_length as string, 10) || 0,
          jumpboxHtml: await fetchAndRenderJumpbox(supabase, undefined, { user }),
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
      .maybeSingle();

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
      .maybeSingle();

    if (postErr || !post) return c.text("Failed to create post", 500);

    // Create post text. Counter updates (forum_posts, forum_topics,
    // topic_replies, topic_first/last_post_id, user_posts,
    // forum_last_post_id) are maintained atomically by triggers
    // installed in 20260430000001_atomic_counters.sql.
    await adminDb.from("posts_text").insert({
      post_id: post.id,
      post_subject: subject,
      post_text: message,
      post_text_html: messageHtml,
    });

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

    if (pollTitle && pollOptionTexts.length >= 2 && canDo("pollcreate", forum, user, userAcls)) {
      const pollLengthDays = parseInt(body.poll_length as string, 10) || 0;
      const { data: poll } = await adminDb
        .from("poll_questions")
        .insert({
          topic_id: topic.id,
          poll_text: pollTitle,
          poll_length: pollLengthDays > 0 ? `${pollLengthDays} days` : null,
        })
        .select()
        .maybeSingle();

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
    // Re-check permissions at submit time.
    const supabase = c.get("supabase");
    const { data: topic } = await supabase
      .from("topics")
      .select("topic_status, forum_id, forums(*)")
      .eq("id", topicId)
      .maybeSingle();
    if (!topic) return c.text("Topic not found", 404);
    const forum = (topic as any).forums;
    if (!forum) return c.text("Topic not found", 404);
    if (!canDo("view", forum, user, userAcls)) return c.text("Topic not found", 404);
    if (!canDo("reply", forum, user, userAcls)) {
      return c.text("You do not have permission to reply in this forum.", 403);
    }
    if (topic.topic_status === 1 && !canMod(forum.id, user, userAcls)) {
      return c.text("This topic is locked.", 403);
    }

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
      .maybeSingle();

    if (postErr || !post) return c.text("Failed to create post", 500);

    await adminDb.from("posts_text").insert({
      post_id: post.id,
      post_subject: subject || `Re: `,
      post_text: message,
      post_text_html: messageHtml,
    });

    // Counters (forum_posts, topic_replies, topic_last_post_id,
    // forum_last_post_id, user_posts) are maintained by triggers.
    // Recompute the page number for the redirect from the updated row.
    const { data: updatedTopic } = await adminDb
      .from("topics")
      .select("topic_replies")
      .eq("id", topicId)
      .maybeSingle();
    const replyCount = (updatedTopic?.topic_replies ?? 0) + 1;

    const postsPerPage = 15;
    const totalPages = Math.ceil(replyCount / postsPerPage);
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
    // Re-check permission against the current ACL state.
    const { data: existingPost } = await adminDb
      .from("posts")
      .select("poster_id, topic_id, topics!posts_topic_id_fkey(forum_id, topic_first_post_id, forums(*))")
      .eq("id", postId)
      .maybeSingle();

    if (!existingPost) return c.text("Post not found", 404);
    const editForum = (existingPost as any).topics?.forums;
    if (!editForum) return c.text("Post not found", 404);
    if (!canDo("view", editForum, user, userAcls)) return c.text("Post not found", 404);
    if (existingPost.poster_id === user.id) {
      if (!canDo("edit", editForum, user, userAcls)) {
        return c.text("You do not have permission to edit posts in this forum.", 403);
      }
    } else if (!canMod(editForum.id, user, userAcls)) {
      return c.text("You cannot edit another user's post.", 403);
    }

    // Update post metadata
    // Get current edit count to increment
    const { data: currentPost } = await adminDb
      .from("posts")
      .select("post_edit_count")
      .eq("id", postId)
      .maybeSingle();

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

    // Update topic type if editing the first post. The requested type
    // is gated per-forum, same rules as creation: sticky/announce need
    // their bit on this forum; global needs admin.
    if (
      requestedTopicType !== undefined &&
      (existingPost as any).topics?.topic_first_post_id === postId
    ) {
      let allowedType = 0;
      if (requestedTopicType === 1 && canDo("sticky", editForum, user, userAcls)) allowedType = 1;
      else if (requestedTopicType === 2 && canDo("announce", editForum, user, userAcls)) allowedType = 2;
      else if (requestedTopicType === 3 && user.userLevel === 1 /* USER_LEVEL.ADMIN */) allowedType = 3;
      await adminDb.from("topics").update({ topic_type: allowedType }).eq("id", existingPost.topic_id);
    }

    // Find the topic for redirect
    const { data: post } = await adminDb
      .from("posts")
      .select("topic_id")
      .eq("id", postId)
      .maybeSingle();

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
      .select("*, topics!posts_topic_id_fkey(topic_first_post_id, forum_id, forums(*))")
      .eq("id", deletePostId)
      .maybeSingle();

    if (!post) return c.text("Post not found", 404);
    const delForum = (post as any).topics?.forums;
    if (!delForum) return c.text("Post not found", 404);
    if (!canDo("view", delForum, user, userAcls)) return c.text("Post not found", 404);
    if (post.poster_id === user.id) {
      if (!canDo("delete", delForum, user, userAcls)) {
        return c.text("You do not have permission to delete posts in this forum.", 403);
      }
    } else if (!canMod(delForum.id, user, userAcls)) {
      return c.text("You cannot delete another user's post.", 403);
    }

    // Cancel → go back to the topic
    if (body.cancel) {
      return c.redirect(`/viewtopic/${post.topic_id}`);
    }

    // Must confirm before deleting
    if (!body.confirm) {
      return c.html(renderConfirmPage({
        c,
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
        .maybeSingle();

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
  c: Context;
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

  // Build hidden fields (CSRF token + mode/forum/topic/post)
  const hiddenFields = formHiddenFields(
    opts.c,
    `<input type="hidden" name="mode" value="${escapeHtml(opts.mode)}" />`,
    opts.forumId ? `<input type="hidden" name="forum_id" value="${opts.forumId}" />` : "",
    opts.topicId ? `<input type="hidden" name="topic_id" value="${opts.topicId}" />` : "",
    opts.postId ? `<input type="hidden" name="post_id" value="${opts.postId}" />` : "",
  );

  // Preview box (opts.preview is HTML from parseBBCode + smilies)
  const previewBox = opts.preview
    ? markup(`<table width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td class="tableborder"><table width="100%" cellpadding="4" cellspacing="1" border="0"><tr><th class="thHead">Preview</th></tr><tr><td class="row1"><span class="postbody">${opts.preview}</span></td></tr></table></td></tr></table><br />`)
    : markup("");

  tpl.assignVars({
    S_POST_ACTION: "/posting",
    POST_PREVIEW_BOX: previewBox,
    ERROR_BOX: opts.error ? renderErrorBox(opts.error) : markup(""),
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
    JUMPBOX: opts.jumpboxHtml ?? markup(""),
    TOPIC_REVIEW_BOX: opts.topicReviewHtml ? markup(opts.topicReviewHtml) : markup(""),
    POLLBOX: opts.showPoll ? markup(renderPollBox(opts.pollTitle ?? "", opts.pollOptions ?? [""], opts.pollLength ?? 0)) : markup(""),
    S_SMILIES_COLSPAN: "4",

    ...POSTING_BBCODE_LABELS,
    ...POSTING_COLOR_LABELS,
    ...POSTING_FONT_SIZE_LABELS,

    // Checkbox options
    HTML_STATUS: "HTML is OFF",
    BBCODE_STATUS: markup('<a href="/faq" target="_phpbbcode">BBCode</a> is <u>ON</u>'),
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
    S_SIGNATURE_CHECKED: opts.user.userSig && opts.user.attachSig ? markup('checked="checked"') : "",
    S_NOTIFY_CHECKED: "",
    S_TYPE_TOGGLE: opts.topicTypeToggle ? markup(opts.topicTypeToggle) : markup(""),

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
  const tpl = createTemplate();
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

  const tpl = createTemplate();
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
  c: Context;
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
    hiddenHtml += `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(val)}" />`;
  }

  tpl.assignVars({
    MESSAGE_TITLE: opts.title,
    MESSAGE_TEXT: opts.message,
    L_YES: "Yes",
    L_NO: "No",
    S_CONFIRM_ACTION: opts.action,
    S_HIDDEN_FIELDS: formHiddenFields(opts.c, hiddenHtml),
    U_INDEX: "/",
    L_INDEX: "Index",
  });

  return renderPage(tpl);
}

export default posting;
