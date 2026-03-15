import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { createPageTemplate, renderPage, formatPhpBBDate, renderErrorBox } from "../lib/render.js";
import { parseBBCode } from "../lib/bbcode.js";
import { loadSmilies, replaceSmilies } from "../lib/smilies.js";
import { generatePagination } from "../lib/pagination.js";

const PMS_PER_PAGE = 25;

// PM type constants (matching phpBB2)
const PM_UNREAD = 0;
const PM_READ = 1;
const PM_NEW = 2;
const PM_SENT = 3;
const PM_SAVED_IN = 4;
const PM_SAVED_OUT = 5;

const privmsg = new Hono();

// ─── PM Listing (Inbox/Sentbox/Outbox/Savebox) ───────────────

privmsg.get("/privmsg", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
  const supabase = c.get("supabase");

  const mode = c.req.query("mode");

  // If reading a single PM
  if (mode === "read") {
    return handleReadPM(c);
  }

  // If composing a new PM
  if (mode === "post") {
    return handleComposePM(c);
  }

  const folder = c.req.query("folder") ?? "inbox";
  const page = parseInt(c.req.query("page") ?? "1", 10);

  // Map folder to PM types
  const folderTypes: Record<string, number[]> = {
    inbox: [PM_UNREAD, PM_READ, PM_NEW],
    sentbox: [PM_SENT],
    outbox: [PM_SENT], // In phpBB2, outbox = sent but not yet read by recipient
    savebox: [PM_SAVED_IN, PM_SAVED_OUT],
  };

  const types = folderTypes[folder] ?? folderTypes.inbox;
  const isInbox = folder === "inbox";

  // Query PMs
  let query = supabase
    .from("privmsgs")
    .select(
      `*, from_user:profiles!privmsgs_privmsgs_from_userid_fkey(id, username),
       to_user:profiles!privmsgs_privmsgs_to_userid_fkey(id, username)`,
      { count: "exact" }
    )
    .in("privmsgs_type", types);

  if (isInbox || folder === "savebox") {
    query = query.eq("privmsgs_to_userid", user.id);
  } else {
    query = query.eq("privmsgs_from_userid", user.id);
  }

  query = query.order("privmsgs_date", { ascending: false });

  const offset = (page - 1) * PMS_PER_PAGE;
  const { data: messages, count: totalMessages } = await query.range(
    offset,
    offset + PMS_PER_PAGE - 1
  );

  const tpl = createPageTemplate({
    user: { id: user.id, username: user.username, unreadPms: user.unreadPms },
    pageTitle: `Private Messages - ${capitalize(folder)}`,
  });

  tpl.loadFile("body", "privmsgs_body.tpl");

  const pagination = generatePagination(
    `/privmsg?folder=${folder}`,
    totalMessages ?? 0,
    PMS_PER_PAGE,
    page
  );

  // Folder nav links
  const folderImg = (name: string, active: boolean) => {
    const cls = active ? "cattitle" : "cattitle";
    return `<a href="/privmsg?folder=${name}">${capitalize(name)}</a>`;
  };

  tpl.assignVars({
    U_INDEX: "/",
    L_INDEX: "Index",
    INBOX: folderImg("inbox", folder === "inbox"),
    INBOX_IMG: "",
    SENTBOX: folderImg("sentbox", folder === "sentbox"),
    SENTBOX_IMG: "",
    OUTBOX: folderImg("outbox", folder === "outbox"),
    OUTBOX_IMG: "",
    SAVEBOX: folderImg("savebox", folder === "savebox"),
    SAVEBOX_IMG: "",

    POST_PM_IMG: `<a href="/privmsg?mode=post"><img src="templates/Solaris/images/lang_english/new_topic.gif" alt="New PM" border="0" /></a>`,
    S_PRIVMSGS_ACTION: `/privmsg?folder=${folder}`,

    L_DISPLAY_MESSAGES: "Display messages from previous",
    S_SELECT_MSG_DAYS: '<option value="0" selected>All Messages</option>',
    L_GO: "Go",

    L_FLAG: "",
    L_SUBJECT: "Subject",
    L_FROM_OR_TO: isInbox ? "From" : "To",
    L_DATE: "Date",
    L_MARK: "Mark",

    L_NO_MESSAGES: "You have no messages",
    L_SAVE_MARKED: "Save Marked",
    L_DELETE_MARKED: "Delete Marked",
    L_DELETE_ALL: "Delete All",
    L_MARK_ALL: "Mark all",
    L_UNMARK_ALL: "Unmark all",

    S_HIDDEN_FIELDS: `<input type="hidden" name="folder" value="${folder}" />`,
    PAGINATION: pagination.html,
    PAGE_NUMBER: pagination.pageNumber,
    S_TIMEZONE: "All times are GMT",
    JUMPBOX: "",
    BOX_SIZE_STATUS: "",
    INBOX_LIMIT_IMG_WIDTH: "0",
    INBOX_LIMIT_PERCENT: "0%",
  });

  if (messages && messages.length > 0) {
    let rowIndex = 0;
    for (const msg of messages) {
      const rowClass = rowIndex % 2 === 0 ? "row1" : "row2";
      const isUnread = msg.privmsgs_type === PM_UNREAD || msg.privmsgs_type === PM_NEW;
      const folderIcon = isUnread
        ? "templates/Solaris/images/folder_new_hot.gif"
        : "templates/Solaris/images/folder.gif";

      const otherUser = isInbox ? msg.from_user : msg.to_user;

      tpl.assignBlockVars("listrow", {
        ROW_CLASS: rowClass,
        PRIVMSG_FOLDER_IMG: folderIcon,
        L_PRIVMSG_FOLDER_ALT: isUnread ? "New Message" : "Read Message",
        SUBJECT: msg.privmsgs_subject,
        U_READ: `/privmsg?mode=read&p=${msg.id}`,
        FROM: otherUser?.username ?? "Unknown",
        U_FROM_USER_PROFILE: `/profile/${otherUser?.id ?? ""}`,
        DATE: formatPhpBBDate(msg.privmsgs_date),
        S_MARK_ID: String(msg.id),
      });
      rowIndex++;
    }
  } else {
    tpl.assignBlockVars("switch_no_messages", {});
  }

  return c.html(renderPage(tpl));
});

// ─── Read PM ──────────────────────────────────────────────────

async function handleReadPM(c: any) {
  const user = c.get("user")!;
  const supabase = c.get("supabase");
  const pmId = parseInt(c.req.query("p") ?? "0", 10);

  const adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: pm } = await adminDb
    .from("privmsgs")
    .select(
      `*, privmsgs_text(*),
       from_user:profiles!privmsgs_privmsgs_from_userid_fkey(id, username, user_avatar, user_sig),
       to_user:profiles!privmsgs_privmsgs_to_userid_fkey(id, username)`
    )
    .eq("id", pmId)
    .single();

  if (!pm) return c.text("Message not found", 404);

  // Check permission
  if (pm.privmsgs_from_userid !== user.id && pm.privmsgs_to_userid !== user.id) {
    return c.text("Forbidden", 403);
  }

  // Mark as read if unread
  if (
    pm.privmsgs_to_userid === user.id &&
    (pm.privmsgs_type === PM_UNREAD || pm.privmsgs_type === PM_NEW)
  ) {
    await adminDb
      .from("privmsgs")
      .update({ privmsgs_type: PM_READ })
      .eq("id", pmId);
  }

  // Render message body
  const smilies = await loadSmilies(supabase);
  let messageHtml = pm.privmsgs_text?.privmsgs_text_html ?? "";
  if (!messageHtml && pm.privmsgs_text?.privmsgs_text) {
    messageHtml = parseBBCode(pm.privmsgs_text.privmsgs_text);
  }
  if (pm.privmsgs_enable_smilies) {
    messageHtml = replaceSmilies(messageHtml, smilies);
  }

  const tpl = createPageTemplate({
    user: { id: user.id, username: user.username, unreadPms: user.unreadPms },
    pageTitle: pm.privmsgs_subject,
  });

  tpl.loadFile("body", "privmsgs_read_body.tpl");

  const isOwnMessage = pm.privmsgs_from_userid === user.id;
  const boxName = isOwnMessage ? "Sentbox" : "Inbox";

  tpl.assignVars({
    U_INDEX: "/",
    L_INDEX: "Index",
    INBOX: `<a href="/privmsg?folder=inbox">Inbox</a>`,
    INBOX_IMG: "",
    SENTBOX: `<a href="/privmsg?folder=sentbox">Sentbox</a>`,
    SENTBOX_IMG: "",
    OUTBOX: `<a href="/privmsg?folder=outbox">Outbox</a>`,
    OUTBOX_IMG: "",
    SAVEBOX: `<a href="/privmsg?folder=savebox">Savebox</a>`,
    SAVEBOX_IMG: "",

    BOX_NAME: boxName,
    L_MESSAGE: "Message",
    L_FROM: "From:",
    MESSAGE_FROM: `<a href="/profile/${pm.from_user?.id}">${pm.from_user?.username ?? "Unknown"}</a>`,
    L_TO: "To:",
    MESSAGE_TO: `<a href="/profile/${pm.to_user?.id}">${pm.to_user?.username ?? "Unknown"}</a>`,
    L_POSTED: "Posted:",
    POST_DATE: formatPhpBBDate(pm.privmsgs_date),
    L_SUBJECT: "Subject:",
    POST_SUBJECT: pm.privmsgs_subject,
    MESSAGE: messageHtml,

    REPLY_PM_IMG: !isOwnMessage
      ? `<a href="/privmsg?mode=post&p=${pmId}"><img src="templates/Solaris/images/lang_english/post_reply.gif" alt="Reply" border="0" /></a>`
      : "",
    QUOTE_PM_IMG: !isOwnMessage
      ? `<a href="/privmsg?mode=post&p=${pmId}&quote=1"><img src="templates/Solaris/images/lang_english/icon_quote.gif" alt="Quote" border="0" /></a>`
      : "",
    EDIT_PM_IMG: "",

    S_PRIVMSGS_ACTION: `/privmsg?mode=read&p=${pmId}`,
    S_HIDDEN_FIELDS: `<input type="hidden" name="pm_id" value="${pmId}" />`,
    L_SAVE_MSG: "Save Message",
    L_DELETE_MSG: "Delete Message",

    // Contact info
    PROFILE_IMG: `<a href="/profile/${pm.from_user?.id}"><img src="templates/Solaris/images/lang_english/icon_profile.gif" alt="Profile" border="0" /></a>`,
    PM_IMG: `<a href="/privmsg?mode=post&u=${pm.from_user?.id}"><img src="templates/Solaris/images/lang_english/icon_pm.gif" alt="PM" border="0" /></a>`,
    EMAIL_IMG: "",
    WWW_IMG: "",
    AIM_IMG: "",
    YIM_IMG: "",
    MSN_IMG: "",
    ICQ_IMG: "",
    ICQ_STATUS_IMG: "",

    S_TIMEZONE: "All times are GMT",
    JUMPBOX: "",
  });

  return c.html(renderPage(tpl));
}

// ─── Compose PM ───────────────────────────────────────────────

interface ComposeOverrides {
  recipientUsername?: string;
  subject?: string;
  message?: string;
  error?: string;
}

async function handleComposePM(c: any, overrides?: ComposeOverrides) {
  const user = c.get("user")!;
  const supabase = c.get("supabase");

  let recipientUsername = overrides?.recipientUsername ?? "";
  let subject = overrides?.subject ?? "";
  let message = overrides?.message ?? "";

  // Pre-fill recipient from query param (skip if re-rendering with overrides)
  const recipientId = c.req.query("u");
  if (recipientId && !overrides) {
    const { data: recipient } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", recipientId)
      .single();
    if (recipient) recipientUsername = recipient.username;
  }

  // Reply to existing PM
  const replyPmId = c.req.query("p");
  const isQuote = c.req.query("quote") === "1";
  if (replyPmId && !overrides) {
    const adminDb = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: pm } = await adminDb
      .from("privmsgs")
      .select(
        "*, privmsgs_text(*), from_user:profiles!privmsgs_privmsgs_from_userid_fkey(username)"
      )
      .eq("id", parseInt(replyPmId, 10))
      .single();

    if (pm) {
      recipientUsername = pm.from_user?.username ?? "";
      subject = pm.privmsgs_subject.startsWith("Re: ")
        ? pm.privmsgs_subject
        : `Re: ${pm.privmsgs_subject}`;
      if (isQuote) {
        message = `[quote="${recipientUsername}"]${pm.privmsgs_text?.privmsgs_text ?? ""}[/quote]\n`;
      }
    }
  }

  const smilies = await loadSmilies(supabase);

  const tpl = createPageTemplate({
    user: { id: user.id, username: user.username, unreadPms: user.unreadPms },
    pageTitle: "Send Private Message",
  });

  // Use posting_body.tpl for compose (same as phpBB2 does)
  tpl.loadFile("body", "posting_body.tpl");

  tpl.assignVars({
    S_POST_ACTION: "/privmsg",
    POST_PREVIEW_BOX: "",
    ERROR_BOX: overrides?.error ? renderErrorBox(overrides.error) : "",
    U_INDEX: "/",
    L_INDEX: "Index",
    U_VIEW_FORUM: "/privmsg?folder=inbox",
    FORUM_NAME: "Private Messages",
    L_POST_A: "Send private message",
    L_SUBJECT: "Subject",
    L_MESSAGE_BODY: "Message body",
    L_EMOTICONS: "Smilies",
    L_OPTIONS: "Options",
    L_PREVIEW: "Preview",
    L_SUBMIT: "Submit",
    L_EMPTY_MESSAGE: "You must enter a message when posting.",
    S_HIDDEN_FORM_FIELDS: '<input type="hidden" name="mode" value="post" />',
    SUBJECT: subject,
    MESSAGE: message,
    S_TIMEZONE: "All times are GMT",
    JUMPBOX: "",
    TOPIC_REVIEW_BOX: "",
    POLLBOX: "",
    S_SMILIES_COLSPAN: "5",

    // Username field for recipient
    L_USERNAME: "Username",
    USERNAME: recipientUsername,
    L_FIND_USERNAME: "Find a username",
    U_SEARCH_USER: "/search?mode=user",

    // BBCode toolbar labels
    L_BBCODE_B_HELP: "Bold text: [b]text[/b]",
    L_BBCODE_I_HELP: "Italic text: [i]text[/i]",
    L_BBCODE_U_HELP: "Underlined text: [u]text[/u]",
    L_BBCODE_Q_HELP: "Quote text: [quote]text[/quote]",
    L_BBCODE_C_HELP: "Code display: [code]code[/code]",
    L_BBCODE_L_HELP: "List: [list]text[/list]",
    L_BBCODE_O_HELP: "Ordered list: [list=]text[/list]",
    L_BBCODE_P_HELP: "Insert image: [img]http://image_url[/img]",
    L_BBCODE_W_HELP: "Insert URL: [url]http://url[/url]",
    L_BBCODE_A_HELP: "Close all open bbCode tags",
    L_BBCODE_S_HELP: "Font color: [color=red]text[/color]",
    L_BBCODE_F_HELP: "Font size: [size=x-small]small text[/size]",
    L_FONT_COLOR: "Font colour",
    L_FONT_SIZE: "Font size",
    L_BBCODE_CLOSE_TAGS: "Close All Tags",
    L_STYLES_TIP: "Tip: Styles can be applied quickly to selected text.",
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
    L_FONT_TINY: "Tiny",
    L_FONT_SMALL: "Small",
    L_FONT_NORMAL: "Normal",
    L_FONT_LARGE: "Large",
    L_FONT_HUGE: "Huge",

    HTML_STATUS: "HTML is OFF",
    BBCODE_STATUS: "BBCode is ON",
    SMILIES_STATUS: "Smilies are ON",
    L_DISABLE_HTML: "Disable HTML",
    L_DISABLE_BBCODE: "Disable BBCode",
    L_DISABLE_SMILIES: "Disable Smilies",
    L_ATTACH_SIGNATURE: "Attach signature",
    L_NOTIFY_ON_REPLY: "Notify on reply",
    L_DELETE_POST: "",
    S_HTML_CHECKED: "",
    S_BBCODE_CHECKED: "",
    S_SMILIES_CHECKED: "",
    S_SIGNATURE_CHECKED: 'checked="checked"',
    S_NOTIFY_CHECKED: "",
    S_TYPE_TOGGLE: "",
    U_MORE_SMILIES: "/posting_smilies",
    L_MORE_SMILIES: "View more smilies",
  });

  // Switches for compose form
  tpl.assignBlockVars("switch_bbcode_checkbox", {});
  tpl.assignBlockVars("switch_smilies_checkbox", {});
  tpl.assignBlockVars("switch_signature_checkbox", {});

  // Smilies grid
  const smiliesPerRow = 5;
  const displaySmilies = smilies.slice(0, 20);
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

  return c.html(renderPage(tpl));
}

// ─── POST: Send PM / Delete PM / Save PM ─────────────────────

privmsg.post("/privmsg", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login");

  const body = await c.req.parseBody();
  const mode = body.mode as string;

  const adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Send new PM
  if (mode === "post") {
    const recipientName = (body.username as string)?.trim();
    const subject = (body.subject as string)?.trim();
    const message = (body.message as string) ?? "";

    if (!recipientName || !subject || !message.trim()) {
      return handleComposePM(c, {
        recipientUsername: recipientName, subject, message,
        error: "All fields are required.",
      });
    }

    // Look up recipient
    const { data: recipient } = await adminDb
      .from("profiles")
      .select("id")
      .eq("username", recipientName)
      .single();

    if (!recipient) {
      return handleComposePM(c, {
        recipientUsername: recipientName, subject, message,
        error: "The specified recipient could not be found.",
      });
    }

    const messageHtml = parseBBCode(message);

    // Create PM
    const { data: pm, error } = await adminDb
      .from("privmsgs")
      .insert({
        privmsgs_type: PM_NEW,
        privmsgs_subject: subject,
        privmsgs_from_userid: user.id,
        privmsgs_to_userid: recipient.id,
        privmsgs_enable_bbcode: body.disable_bbcode !== "on",
        privmsgs_enable_smilies: body.disable_smilies !== "on",
        privmsgs_attach_sig: body.attach_sig === "on",
      })
      .select()
      .single();

    if (error || !pm) {
      return handleComposePM(c, {
        recipientUsername: recipientName, subject, message,
        error: "Failed to send message.",
      });
    }

    await adminDb.from("privmsgs_text").insert({
      privmsgs_text_id: pm.id,
      privmsgs_text: message,
      privmsgs_text_html: messageHtml,
    });

    return c.redirect("/privmsg?folder=sentbox");
  }

  // Delete PM(s)
  if (body.delete) {
    const pmId = body.pm_id as string;
    if (pmId) {
      // Single PM delete from read view
      const { data: pm } = await adminDb
        .from("privmsgs")
        .select("privmsgs_from_userid, privmsgs_to_userid")
        .eq("id", parseInt(pmId, 10))
        .single();

      if (pm && (pm.privmsgs_from_userid === user.id || pm.privmsgs_to_userid === user.id)) {
        await adminDb.from("privmsgs").delete().eq("id", parseInt(pmId, 10));
      }
    }
    const folder = body.folder as string ?? "inbox";
    return c.redirect(`/privmsg?folder=${folder}`);
  }

  // Save PM(s)
  if (body.save) {
    const pmId = body.pm_id as string;
    if (pmId) {
      const { data: pm } = await adminDb
        .from("privmsgs")
        .select("privmsgs_from_userid, privmsgs_to_userid")
        .eq("id", parseInt(pmId, 10))
        .single();

      if (pm) {
        const newType =
          pm.privmsgs_from_userid === user.id ? PM_SAVED_OUT : PM_SAVED_IN;
        await adminDb
          .from("privmsgs")
          .update({ privmsgs_type: newType })
          .eq("id", parseInt(pmId, 10));
      }
    }
    return c.redirect("/privmsg?folder=savebox");
  }

  // Delete all from folder
  if (body.deleteall) {
    const folder = body.folder as string ?? "inbox";
    const folderTypes: Record<string, number[]> = {
      inbox: [PM_UNREAD, PM_READ, PM_NEW],
      sentbox: [PM_SENT],
      savebox: [PM_SAVED_IN, PM_SAVED_OUT],
    };
    const types = folderTypes[folder] ?? folderTypes.inbox;
    const isInbox = folder === "inbox" || folder === "savebox";

    let deleteQuery = adminDb
      .from("privmsgs")
      .delete()
      .in("privmsgs_type", types);

    if (isInbox) {
      deleteQuery = deleteQuery.eq("privmsgs_to_userid", user.id);
    } else {
      deleteQuery = deleteQuery.eq("privmsgs_from_userid", user.id);
    }
    await deleteQuery;

    return c.redirect(`/privmsg?folder=${folder}`);
  }

  return c.redirect("/privmsg?folder=inbox");
});

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default privmsg;
