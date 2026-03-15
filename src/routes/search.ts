import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { createPageTemplate, renderPage, formatPhpBBDate } from "../lib/render.js";
import { parseBBCode } from "../lib/bbcode.js";
import { generatePagination } from "../lib/pagination.js";

const RESULTS_PER_PAGE = 25;

const search = new Hono();

// ─── Search Form ──────────────────────────────────────────────

search.get("/search", async (c) => {
  const user = c.get("user");
  const supabase = c.get("supabase");

  // Check for quick search or keyword-based search
  const keywords = c.req.query("search_keywords") ?? "";
  const author = c.req.query("search_author") ?? "";
  const mode = c.req.query("mode");

  // Quick searches
  if (mode === "newposts" && user) {
    return handleNewPosts(c);
  }
  if (mode === "egosearch" && user) {
    return handleResults(c, { author: user.username });
  }
  if (mode === "unanswered") {
    return handleUnanswered(c);
  }

  // If we have search parameters, show results
  if (keywords || author) {
    return handleResults(c, { keywords, author });
  }

  // Show search form
  const tpl = createPageTemplate({
    user: user
      ? { id: user.id, username: user.username, unreadPms: user.unreadPms }
      : null,
    pageTitle: "Search",
  });

  tpl.loadFile("body", "search_body.tpl");

  // Build forum options
  const { data: forums } = await supabase
    .from("forums")
    .select("id, forum_name")
    .order("forum_order");

  let forumOptions = '<option value="0">All Forums</option>';
  if (forums) {
    for (const f of forums) {
      forumOptions += `<option value="${f.id}">${f.forum_name}</option>`;
    }
  }

  // Time options
  const timeOptions = [
    '<option value="0" selected>All Posts</option>',
    '<option value="1">1 Day</option>',
    '<option value="7">7 Days</option>',
    '<option value="14">2 Weeks</option>',
    '<option value="30">1 Month</option>',
    '<option value="90">3 Months</option>',
    '<option value="180">6 Months</option>',
    '<option value="365">1 Year</option>',
  ].join("");

  // Sort options
  const sortOptions = [
    '<option value="time" selected>Post Time</option>',
    '<option value="subject">Subject</option>',
    '<option value="author">Author</option>',
    '<option value="forum">Forum</option>',
  ].join("");

  // Character limit options
  const charOptions = [
    '<option value="0">All</option>',
    '<option value="100">100</option>',
    '<option value="200" selected>200</option>',
    '<option value="500">500</option>',
    '<option value="1000">1000</option>',
  ].join("");

  tpl.assignVars({
    S_SEARCH_ACTION: "/search",
    U_INDEX: "/",
    L_INDEX: "Index",
    L_SEARCH_QUERY: "Search Query",
    L_SEARCH_KEYWORDS: "Search for Keywords:",
    L_SEARCH_KEYWORDS_EXPLAIN:
      "You can use AND to define words which must be in the results, OR for words which may be in the result and NOT to define words which should not be in the result.",
    L_SEARCH_ANY_TERMS: "Search for any terms",
    L_SEARCH_ALL_TERMS: "Search for all terms",
    L_SEARCH_AUTHOR: "Search for Author:",
    L_SEARCH_AUTHOR_EXPLAIN: "Use * as a wildcard for partial matches.",
    L_SEARCH_OPTIONS: "Search Options",
    L_FORUM: "Forum:",
    S_FORUM_OPTIONS: forumOptions,
    L_SEARCH_PREVIOUS: "Search previous:",
    S_TIME_OPTIONS: timeOptions,
    L_SEARCH_MESSAGE_TITLE: "Search message text and topic titles",
    L_SEARCH_MESSAGE_ONLY: "Search message text only",
    L_CATEGORY: "Category:",
    S_CATEGORY_OPTIONS: '<option value="0">All Categories</option>',
    L_SORT_BY: "Sort by:",
    S_SORT_OPTIONS: sortOptions,
    L_SORT_ASCENDING: "Ascending",
    L_SORT_DESCENDING: "Descending",
    L_DISPLAY_RESULTS: "Display results as:",
    L_POSTS: "Posts",
    L_TOPICS: "Topics",
    L_RETURN_FIRST: "Return first:",
    S_CHARACTER_OPTIONS: charOptions,
    L_CHARACTERS: "characters of each post",
    L_SEARCH: "Search",
    S_HIDDEN_FIELDS: "",
    S_TIMEZONE: "All times are GMT",
    JUMPBOX: "",
  });

  return c.html(renderPage(tpl));
});

// ─── Search Form POST ─────────────────────────────────────────

search.post("/search", async (c) => {
  const body = await c.req.parseBody();
  const keywords = (body.search_keywords as string)?.trim() ?? "";
  const author = (body.search_author as string)?.trim() ?? "";
  const showResults = (body.show_results as string) ?? "topics";
  const forumId = parseInt(body.search_forum as string, 10) || 0;
  const searchTime = parseInt(body.search_time as string, 10) || 0;

  // Redirect to GET with params
  const params = new URLSearchParams();
  if (keywords) params.set("search_keywords", keywords);
  if (author) params.set("search_author", author);
  params.set("show_results", showResults);
  if (forumId) params.set("forum_id", String(forumId));
  if (searchTime) params.set("search_time", String(searchTime));

  return c.redirect(`/search?${params.toString()}`);
});

// ─── Search Results ───────────────────────────────────────────

interface SearchParams {
  keywords?: string;
  author?: string;
}

async function handleResults(c: any, params: SearchParams) {
  const user = c.get("user");
  const page = parseInt(c.req.query("page") ?? "1", 10);
  const showResults = c.req.query("show_results") ?? "topics";
  const forumId = parseInt(c.req.query("forum_id") ?? "0", 10);
  const searchTime = parseInt(c.req.query("search_time") ?? "0", 10);

  const adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const offset = (page - 1) * RESULTS_PER_PAGE;

  if (showResults === "posts") {
    return handlePostResults(c, adminDb, params, page, offset, forumId, searchTime);
  }
  return handleTopicResults(c, adminDb, params, page, offset, forumId, searchTime);
}

async function handleTopicResults(
  c: any,
  adminDb: any,
  params: SearchParams,
  page: number,
  offset: number,
  forumId: number,
  searchTime: number
) {
  const user = c.get("user");

  // Build query to find matching topics
  let query = adminDb
    .from("posts")
    .select(
      `topic_id,
       posts_text!inner(post_subject, post_text, search_vector),
       topics!posts_topic_id_fkey(
         id, topic_title, topic_replies, topic_views, topic_poster,
         topic_last_post_id, topic_type, topic_status,
         forum_id, forums(forum_name),
         poster:profiles!topics_topic_poster_fkey(username)
       )`,
      { count: "exact" }
    );

  // Full-text search
  if (params.keywords) {
    const tsQuery = params.keywords
      .split(/\s+/)
      .filter(Boolean)
      .join(" & ");
    query = query.textSearch("posts_text.search_vector", tsQuery);
  }

  // Author filter
  if (params.author) {
    const { data: authorProfile } = await adminDb
      .from("profiles")
      .select("id")
      .ilike("username", params.author.replace(/\*/g, "%"))
      .single();
    if (authorProfile) {
      query = query.eq("poster_id", authorProfile.id);
    }
  }

  // Forum filter
  if (forumId) {
    query = query.eq("forum_id", forumId);
  }

  // Time filter
  if (searchTime > 0) {
    const since = new Date(Date.now() - searchTime * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte("post_time", since);
  }

  const { data: posts, count } = await query
    .order("post_time", { ascending: false })
    .range(offset, offset + RESULTS_PER_PAGE - 1);

  // Deduplicate by topic_id
  const seenTopics = new Set<number>();
  const uniqueTopics: any[] = [];
  if (posts) {
    for (const post of posts) {
      if (!seenTopics.has(post.topic_id)) {
        seenTopics.add(post.topic_id);
        uniqueTopics.push(post);
      }
    }
  }

  const tpl = createPageTemplate({
    user: user
      ? { id: user.id, username: user.username, unreadPms: user.unreadPms }
      : null,
    pageTitle: "Search Results",
  });

  tpl.loadFile("body", "search_results_topics.tpl");

  const searchDesc = params.keywords
    ? `Search found ${count ?? 0} match${count !== 1 ? "es" : ""} for: ${params.keywords}`
    : params.author
    ? `Search found ${count ?? 0} match${count !== 1 ? "es" : ""} by: ${params.author}`
    : `Search found ${count ?? 0} result${count !== 1 ? "s" : ""}`;

  const pagination = generatePagination(
    `/search?${new URLSearchParams(Object.fromEntries(Object.entries({ search_keywords: params.keywords, search_author: params.author, show_results: "topics" }).filter(([, v]) => v))).toString()}`,
    count ?? 0,
    RESULTS_PER_PAGE,
    page
  );

  tpl.assignVars({
    U_INDEX: "/",
    L_INDEX: "Index",
    L_SEARCH_MATCHES: searchDesc,
    L_FORUM: "Forum",
    L_TOPICS: "Topic",
    L_AUTHOR: "Author",
    L_REPLIES: "Replies",
    L_VIEWS: "Views",
    L_LASTPOST: "Last Post",
    PAGINATION: pagination.html,
    PAGE_NUMBER: pagination.pageNumber,
    S_TIMEZONE: "All times are GMT",
    JUMPBOX: "",
  });

  for (const post of uniqueTopics) {
    const topic = post.topics;
    if (!topic) continue;

    tpl.assignBlockVars("searchresults", {
      TOPIC_FOLDER_IMG: "templates/Solaris/images/folder.gif",
      L_TOPIC_FOLDER_ALT: "No new posts",
      FORUM_NAME: topic.forums?.forum_name ?? "",
      U_VIEW_FORUM: `/viewforum/${topic.forum_id}`,
      TOPIC_TITLE: topic.topic_title,
      U_VIEW_TOPIC: `/viewtopic/${topic.id}`,
      TOPIC_AUTHOR: topic.poster?.username ?? "",
      REPLIES: String(topic.topic_replies ?? 0),
      VIEWS: String(topic.topic_views ?? 0),
      LAST_POST_TIME: "",
      LAST_POST_AUTHOR: "",
      LAST_POST_IMG: "",
      NEWEST_POST_IMG: "",
      TOPIC_TYPE: "",
      GOTO_PAGE: "",
    });
  }

  return c.html(renderPage(tpl));
}

async function handlePostResults(
  c: any,
  adminDb: any,
  params: SearchParams,
  page: number,
  offset: number,
  forumId: number,
  searchTime: number
) {
  const user = c.get("user");

  let query = adminDb
    .from("posts")
    .select(
      `*,
       posts_text!inner(post_subject, post_text, search_vector),
       poster:profiles!posts_poster_id_fkey(username),
       topics!posts_topic_id_fkey(id, topic_title, topic_replies, topic_views, forum_id, forums(forum_name))`,
      { count: "exact" }
    );

  if (params.keywords) {
    const tsQuery = params.keywords
      .split(/\s+/)
      .filter(Boolean)
      .join(" & ");
    query = query.textSearch("posts_text.search_vector", tsQuery);
  }

  if (params.author) {
    const { data: authorProfile } = await adminDb
      .from("profiles")
      .select("id")
      .ilike("username", params.author.replace(/\*/g, "%"))
      .single();
    if (authorProfile) {
      query = query.eq("poster_id", authorProfile.id);
    }
  }

  if (forumId) {
    query = query.eq("forum_id", forumId);
  }

  if (searchTime > 0) {
    const since = new Date(Date.now() - searchTime * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte("post_time", since);
  }

  const { data: posts, count } = await query
    .order("post_time", { ascending: false })
    .range(offset, offset + RESULTS_PER_PAGE - 1);

  const tpl = createPageTemplate({
    user: user
      ? { id: user.id, username: user.username, unreadPms: user.unreadPms }
      : null,
    pageTitle: "Search Results",
  });

  tpl.loadFile("body", "search_results_posts.tpl");

  const searchDesc = params.keywords
    ? `Search found ${count ?? 0} match${count !== 1 ? "es" : ""} for: ${params.keywords}`
    : params.author
    ? `Search found ${count ?? 0} match${count !== 1 ? "es" : ""} by: ${params.author}`
    : `Search found ${count ?? 0} result${count !== 1 ? "s" : ""}`;

  const pagination = generatePagination(
    `/search?${new URLSearchParams(Object.fromEntries(Object.entries({ search_keywords: params.keywords, search_author: params.author, show_results: "posts" }).filter(([, v]) => v))).toString()}`,
    count ?? 0,
    RESULTS_PER_PAGE,
    page
  );

  tpl.assignVars({
    U_INDEX: "/",
    L_INDEX: "Index",
    L_SEARCH_MATCHES: searchDesc,
    L_AUTHOR: "Author",
    L_MESSAGE: "Message",
    L_TOPIC: "Topic",
    L_REPLIES: "Replies",
    L_VIEWS: "Views",
    L_FORUM: "Forum",
    L_POSTED: "Posted:",
    L_SUBJECT: "Subject:",
    PAGINATION: pagination.html,
    PAGE_NUMBER: pagination.pageNumber,
    S_TIMEZONE: "All times are GMT",
    JUMPBOX: "",
  });

  if (posts) {
    for (const post of posts) {
      const topic = post.topics;
      // Truncate message for display
      let messagePreview = post.posts_text?.post_text ?? "";
      if (messagePreview.length > 200) {
        messagePreview = messagePreview.substring(0, 200) + "...";
      }
      messagePreview = parseBBCode(messagePreview);

      tpl.assignBlockVars("searchresults", {
        TOPIC_TITLE: topic?.topic_title ?? "",
        U_TOPIC: `/viewtopic/${topic?.id ?? post.topic_id}`,
        POSTER_NAME: post.poster?.username ?? "Guest",
        TOPIC_REPLIES: String(topic?.topic_replies ?? 0),
        TOPIC_VIEWS: String(topic?.topic_views ?? 0),
        FORUM_NAME: topic?.forums?.forum_name ?? "",
        U_FORUM: `/viewforum/${topic?.forum_id ?? post.forum_id}`,
        POST_DATE: formatPhpBBDate(post.post_time),
        POST_SUBJECT: post.posts_text?.post_subject ?? "",
        U_POST: `/viewtopic/${post.topic_id}#${post.id}`,
        MESSAGE: messagePreview,
        MINI_POST_IMG: "templates/Solaris/images/icon_minipost.gif",
        L_MINI_POST_ALT: "Post",
      });
    }
  }

  return c.html(renderPage(tpl));
}

// ─── Quick Search: New Posts ──────────────────────────────────

async function handleNewPosts(c: any) {
  const user = c.get("user")!;
  const supabase = c.get("supabase");
  const page = parseInt(c.req.query("page") ?? "1", 10);

  // Find posts made since user's last visit
  const adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: profile } = await adminDb
    .from("profiles")
    .select("user_lastvisit")
    .eq("id", user.id)
    .single();

  const since = profile?.user_lastvisit ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const offset = (page - 1) * RESULTS_PER_PAGE;
  const { data: topics, count } = await adminDb
    .from("topics")
    .select(
      `*, forums(forum_name), poster:profiles!topics_topic_poster_fkey(username)`,
      { count: "exact" }
    )
    .gte("topic_last_post_id", 0)
    .order("topic_last_post_id", { ascending: false })
    .range(offset, offset + RESULTS_PER_PAGE - 1);

  const tpl = createPageTemplate({
    user: { id: user.id, username: user.username, unreadPms: user.unreadPms },
    pageTitle: "View new posts since last visit",
  });

  tpl.loadFile("body", "search_results_topics.tpl");

  const pagination = generatePagination(
    "/search?mode=newposts",
    count ?? 0,
    RESULTS_PER_PAGE,
    page
  );

  tpl.assignVars({
    U_INDEX: "/",
    L_INDEX: "Index",
    L_SEARCH_MATCHES: `View new posts since last visit (${count ?? 0} topics)`,
    L_FORUM: "Forum",
    L_TOPICS: "Topic",
    L_AUTHOR: "Author",
    L_REPLIES: "Replies",
    L_VIEWS: "Views",
    L_LASTPOST: "Last Post",
    PAGINATION: pagination.html,
    PAGE_NUMBER: pagination.pageNumber,
    S_TIMEZONE: "All times are GMT",
    JUMPBOX: "",
  });

  if (topics) {
    for (const topic of topics) {
      tpl.assignBlockVars("searchresults", {
        TOPIC_FOLDER_IMG: "templates/Solaris/images/folder_new.gif",
        L_TOPIC_FOLDER_ALT: "New posts",
        FORUM_NAME: topic.forums?.forum_name ?? "",
        U_VIEW_FORUM: `/viewforum/${topic.forum_id}`,
        TOPIC_TITLE: topic.topic_title,
        U_VIEW_TOPIC: `/viewtopic/${topic.id}`,
        TOPIC_AUTHOR: topic.poster?.username ?? "",
        REPLIES: String(topic.topic_replies ?? 0),
        VIEWS: String(topic.topic_views ?? 0),
        LAST_POST_TIME: "",
        LAST_POST_AUTHOR: "",
        LAST_POST_IMG: "",
        NEWEST_POST_IMG: "",
        TOPIC_TYPE: "",
        GOTO_PAGE: "",
      });
    }
  }

  return c.html(renderPage(tpl));
}

// ─── Quick Search: Unanswered ─────────────────────────────────

async function handleUnanswered(c: any) {
  const user = c.get("user");
  const page = parseInt(c.req.query("page") ?? "1", 10);

  const adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const offset = (page - 1) * RESULTS_PER_PAGE;
  const { data: topics, count } = await adminDb
    .from("topics")
    .select(
      `*, forums(forum_name), poster:profiles!topics_topic_poster_fkey(username)`,
      { count: "exact" }
    )
    .eq("topic_replies", 0)
    .order("id", { ascending: false })
    .range(offset, offset + RESULTS_PER_PAGE - 1);

  const tpl = createPageTemplate({
    user: user
      ? { id: user.id, username: user.username, unreadPms: user.unreadPms }
      : null,
    pageTitle: "View unanswered posts",
  });

  tpl.loadFile("body", "search_results_topics.tpl");

  const pagination = generatePagination(
    "/search?mode=unanswered",
    count ?? 0,
    RESULTS_PER_PAGE,
    page
  );

  tpl.assignVars({
    U_INDEX: "/",
    L_INDEX: "Index",
    L_SEARCH_MATCHES: `View unanswered posts (${count ?? 0} topics)`,
    L_FORUM: "Forum",
    L_TOPICS: "Topic",
    L_AUTHOR: "Author",
    L_REPLIES: "Replies",
    L_VIEWS: "Views",
    L_LASTPOST: "Last Post",
    PAGINATION: pagination.html,
    PAGE_NUMBER: pagination.pageNumber,
    S_TIMEZONE: "All times are GMT",
    JUMPBOX: "",
  });

  if (topics) {
    for (const topic of topics) {
      tpl.assignBlockVars("searchresults", {
        TOPIC_FOLDER_IMG: "templates/Solaris/images/folder.gif",
        L_TOPIC_FOLDER_ALT: "No new posts",
        FORUM_NAME: topic.forums?.forum_name ?? "",
        U_VIEW_FORUM: `/viewforum/${topic.forum_id}`,
        TOPIC_TITLE: topic.topic_title,
        U_VIEW_TOPIC: `/viewtopic/${topic.id}`,
        TOPIC_AUTHOR: topic.poster?.username ?? "",
        REPLIES: "0",
        VIEWS: String(topic.topic_views ?? 0),
        LAST_POST_TIME: "",
        LAST_POST_AUTHOR: "",
        LAST_POST_IMG: "",
        NEWEST_POST_IMG: "",
        TOPIC_TYPE: "",
        GOTO_PAGE: "",
      });
    }
  }

  return c.html(renderPage(tpl));
}

export default search;
