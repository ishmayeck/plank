import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { createPageTemplate, renderPage } from "../lib/render.js";
import { parseBBCode } from "../lib/bbcode.js";
import { loadSmilies, type Smiley } from "../lib/smilies.js";

const posting = new Hono();

// ─── GET: Show posting form ────────────────────────────────────

posting.get("/posting", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
  const mode = c.req.query("mode") ?? "newtopic";
  const supabase = c.get("supabase");

  let forumId: number | null = null;
  let topicId: number | null = null;
  let postId: number | null = null;
  let subject = "";
  let message = "";
  let forumName = "";
  let postTitle = "Post a new topic";

  if (mode === "newtopic") {
    forumId = parseInt(c.req.query("f") ?? "0", 10);
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
      .select("*, posts_text(*), topics!posts_topic_id_fkey(topic_title, forum_id, forums(forum_name))")
      .eq("id", postId)
      .single();
    if (!post) return c.text("Post not found", 404);
    // Check permission: own post or mod/admin
    if (post.poster_id !== user.id && user.userLevel < 1) {
      return c.text("Forbidden", 403);
    }
    topicId = post.topic_id;
    forumId = post.topics?.forum_id ?? 0;
    forumName = post.topics?.forums?.forum_name ?? "";
    subject = post.posts_text?.post_subject ?? "";
    message = post.posts_text?.post_text ?? "";
    postTitle = "Edit post";
  }

  const smilies = await loadSmilies(supabase);
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
  });

  return c.html(html);
});

// ─── POST: Submit post ─────────────────────────────────────────

posting.post("/posting", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
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
    });
    return c.html(html);
  }

  // Validation (skip for delete mode)
  if (mode !== "delete" && !message.trim()) {
    return c.text("Message cannot be empty", 400);
  }

  const adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Pre-render BBCode to HTML
  const messageHtml = enableBBCode ? parseBBCode(message) : message;

  if (mode === "newtopic") {
    if (!subject.trim()) {
      return c.text("Subject is required for new topics", 400);
    }

    // Create topic
    const { data: topic, error: topicErr } = await adminDb
      .from("topics")
      .insert({
        forum_id: forumId,
        topic_title: subject,
        topic_poster: user.id,
        topic_type: parseInt(body.topic_type as string, 10) || 0,
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

    return c.redirect(`/viewtopic/${topic.id}`);

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

    // Update forum last post
    await adminDb
      .from("forums")
      .update({ forum_last_post_id: post.id })
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

    // Redirect to last page of topic
    const postsPerPage = 15;
    const totalPages = Math.ceil((replyCount ?? 1) / postsPerPage);
    const redirect = totalPages > 1
      ? `/viewtopic/${topicId}?page=${totalPages}#${post.id}`
      : `/viewtopic/${topicId}#${post.id}`;

    return c.redirect(redirect);

  } else if (mode === "editpost") {
    // Verify permission
    const { data: existingPost } = await adminDb
      .from("posts")
      .select("poster_id")
      .eq("id", postId)
      .single();

    if (!existingPost) return c.text("Post not found", 404);
    if (existingPost.poster_id !== user.id && user.userLevel < 1) {
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

    // Find the topic for redirect
    const { data: post } = await adminDb
      .from("posts")
      .select("topic_id")
      .eq("id", postId)
      .single();

    return c.redirect(`/viewtopic/${post?.topic_id ?? topicId}#${postId}`);

  } else if (mode === "delete") {
    const deletePostId = parseInt(c.req.query("p") ?? body.post_id as string, 10);
    const { data: post } = await adminDb
      .from("posts")
      .select("*, topics!posts_topic_id_fkey(topic_first_post_id, forum_id)")
      .eq("id", deletePostId)
      .single();

    if (!post) return c.text("Post not found", 404);
    if (post.poster_id !== user.id && user.userLevel < 1) {
      return c.text("Forbidden", 403);
    }

    const isFirstPost = post.topics?.topic_first_post_id === deletePostId;
    const redirectForumId = post.topics?.forum_id ?? post.forum_id;

    if (isFirstPost) {
      // Delete entire topic (cascade deletes posts)
      await adminDb.from("topics").delete().eq("id", post.topic_id);
      return c.redirect(`/viewforum/${redirectForumId}`);
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

      return c.redirect(`/viewtopic/${post.topic_id}`);
    }
  }

  return c.text("Invalid mode", 400);
});

// ─── Rendering Helper ──────────────────────────────────────────

interface PostingFormOpts {
  user: { id: string; username: string; unreadPms: number; userLevel: number };
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
}

function renderPostingForm(opts: PostingFormOpts): string {
  const tpl = createPageTemplate({
    user: { id: opts.user.id, username: opts.user.username, unreadPms: opts.user.unreadPms },
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
    ERROR_BOX: "",
    U_INDEX: "/",
    L_INDEX: "Index",
    U_VIEW_FORUM: opts.forumId ? `/viewforum/${opts.forumId}` : "/",
    FORUM_NAME: opts.forumName,
    L_POST_A: opts.postTitle,
    L_SUBJECT: "Subject",
    L_MESSAGE_BODY: "Message body",
    L_EMOTICONS: "Smilies",
    L_OPTIONS: "Options",
    L_PREVIEW: "Preview",
    L_SUBMIT: "Submit",
    L_EMPTY_MESSAGE: "The message body cannot be empty.",
    S_HIDDEN_FORM_FIELDS: hiddenFields,
    SUBJECT: opts.subject,
    MESSAGE: opts.message,
    S_TIMEZONE: "All times are GMT",
    JUMPBOX: "",
    TOPIC_REVIEW_BOX: "",
    POLLBOX: "",
    S_SMILIES_COLSPAN: "5",

    // BBCode toolbar labels
    L_BBCODE_B_HELP: "Bold text: [b]text[/b]",
    L_BBCODE_I_HELP: "Italic text: [i]text[/i]",
    L_BBCODE_U_HELP: "Underlined text: [u]text[/u]",
    L_BBCODE_Q_HELP: "Quote text: [quote]text[/quote]",
    L_BBCODE_C_HELP: "Code display: [code]code[/code]",
    L_BBCODE_L_HELP: "List: [list]text[/list]",
    L_BBCODE_O_HELP: "Ordered list: [list=]text[/list]",
    L_BBCODE_P_HELP: "Insert image: [img]http://image_url[/img]",
    L_BBCODE_W_HELP: "Insert URL: [url]http://url[/url] or [url=http://url]text[/url]",
    L_BBCODE_A_HELP: "Close all open bbCode tags",
    L_BBCODE_S_HELP: "Font color: [color=red]text[/color]",
    L_BBCODE_F_HELP: "Font size: [size=x-small]small text[/size]",
    L_FONT_COLOR: "Font colour",
    L_FONT_SIZE: "Font size",
    L_BBCODE_CLOSE_TAGS: "Close All Tags",
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
    BBCODE_STATUS: "BBCode is ON",
    SMILIES_STATUS: "Smilies are ON",
    L_DISABLE_HTML: "Disable HTML in this post",
    L_DISABLE_BBCODE: "Disable BBCode in this post",
    L_DISABLE_SMILIES: "Disable Smilies in this post",
    L_ATTACH_SIGNATURE: "Attach signature",
    L_NOTIFY_ON_REPLY: "Notify me when a reply is posted",
    L_DELETE_POST: "Delete this post",
    S_HTML_CHECKED: "",
    S_BBCODE_CHECKED: "",
    S_SMILIES_CHECKED: "",
    S_SIGNATURE_CHECKED: 'checked="checked"',
    S_NOTIFY_CHECKED: "",
    S_TYPE_TOGGLE: "",

    L_USERNAME: "Username",
    USERNAME: opts.user.username,
    L_FIND_USERNAME: "Find a username",
    U_SEARCH_USER: "/search?mode=user",

    U_MORE_SMILIES: "/posting_smilies",
    L_MORE_SMILIES: "View more smilies",
  });

  // Switches for the posting form
  tpl.assignBlockVars("switch_not_privmsg", {});
  tpl.assignBlockVars("switch_bbcode_checkbox", {});
  tpl.assignBlockVars("switch_smilies_checkbox", {});
  tpl.assignBlockVars("switch_signature_checkbox", {});
  tpl.assignBlockVars("switch_notify_checkbox", {});

  if (opts.mode === "editpost") {
    tpl.assignBlockVars("switch_delete_checkbox", {});
  }

  // Smilies grid (show first 20 in a 5-column grid)
  const smiliesPerRow = 5;
  const displaySmilies = opts.smilies.slice(0, 20);
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

export default posting;
