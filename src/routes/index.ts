import { Hono } from "hono";
import { createPageTemplate, renderPage } from "../lib/render.js";

const index = new Hono();

index.get("/", async (c) => {
  const user = c.get("user");
  const supabase = c.get("supabase");

  const tpl = createPageTemplate({
    user: user ? { id: user.id, username: user.username, unreadPms: user.unreadPms } : null,
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
    .select("username")
    .order("user_regdate", { ascending: false })
    .limit(1)
    .single();

  tpl.assignVars({
    // Index labels
    L_INDEX: "Index",
    U_INDEX: "/",
    L_FORUM: "Forum",
    L_TOPICS: "Topics",
    L_POSTS: "Posts",
    L_LASTPOST: "Last Post",
    L_WHO_IS_ONLINE: "Who Is Online",
    L_WHOSONLINE_ADMIN: "Admin",
    L_WHOSONLINE_MOD: "Mod",
    L_ONLINE_EXPLAIN: "",
    L_NEW_POSTS: "New posts",
    L_NO_NEW_POSTS: "No new posts",
    L_FORUM_LOCKED: "Forum locked",
    L_MARK_FORUMS_READ: "Mark all forums read",

    // Stats
    TOTAL_POSTS: `${totalPosts ?? 0} posts total`,
    TOTAL_USERS: `${totalUsers ?? 0} registered users`,
    NEWEST_USER: newestUser?.username ?? "Nobody",
    TOTAL_USERS_ONLINE: "1 user online",
    RECORD_USERS: String(totalUsers ?? 0),
    LOGGED_IN_USER_LIST: user?.username ?? "",
    CURRENT_TIME: new Date().toUTCString(),

    // Links
    U_VIEWONLINE: "/viewonline",
    U_MARK_READ: "/markread",
    S_TIMEZONE: "UTC",

    // Login form (shown for logged-out users)
    S_LOGIN_ACTION: "/login",
    L_USERNAME: "Username",
    L_PASSWORD: "Password",
    L_AUTO_LOGIN: "Log me on automatically",
    L_LOGIN: "Login",

    // Search links
    U_SEARCH_NEW: "/search?mode=new",
    U_SEARCH_SELF: "/search?mode=self",
    L_SEARCH_NEW: "View posts since last visit",
    L_SEARCH_SELF: "View your posts",
    U_SEARCH_UNANSWERED: "/search?mode=unanswered",
    L_SEARCH_UNANSWERED: "View unanswered posts",
    LAST_VISIT_DATE: "",
  });

  if (user) {
    tpl.assignBlockVars("switch_user_logged_in", {});
  } else {
    tpl.assignBlockVars("switch_allow_autologin", {});
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
        tpl.assignBlockVars("catrow.forumrow", {
          FORUM_FOLDER_IMG: "templates/Solaris/images/folder.gif",
          U_VIEWFORUM: `/viewforum/${forum.id}`,
          FORUM_NAME: forum.forum_name,
          FORUM_DESC: forum.forum_desc ?? "",
          L_MODERATOR: "Moderator:",
          MODERATORS: "Admin",
          TOPICS: String(forum.forum_topics),
          POSTS: String(forum.forum_posts),
          LAST_POST: "No posts",
        });
      }
    }
  }

  return c.html(renderPage(tpl));
});

export default index;
