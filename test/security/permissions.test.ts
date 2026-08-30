import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";
import { cleanupTestUser } from "../util/users.js";

// End-to-end coverage for per-forum ACLs (Chunk 17). The unit tests in
// test/lib/permissions.test.ts cover canDo/canMod in isolation; this
// file asserts that the route handlers actually call them and that
// the user-visible behaviour matches the gates: hidden forums stay
// hidden, restricted-post forums refuse posts, per-forum mods get mod
// powers on their forum but not on others.

config({ path: ".env" });

let adminDb: SupabaseClient;

let privateForumId: number;          // auth_view = ACL — only members of privGroup see it
let postOnlyForumId: number;         // auth_post = ACL — only members of postGroup can start topics
let modForumId: number;              // generic forum; modGroup has auth_mod here
let privGroupId: number;
let postGroupId: number;
let modGroupId: number;

let guestSeenId: string;             // not used; reserved if we add guest tests later
let regularUserId: string;
let regularAccess: string;
let regularRefresh: string;
let groupMemberUserId: string;       // in privGroup → can view privateForum
let groupMemberAccess: string;
let groupMemberRefresh: string;
let postMemberUserId: string;        // in postGroup → can post in postOnlyForum
let postMemberAccess: string;
let postMemberRefresh: string;
let perForumModUserId: string;       // in modGroup → mod of modForum, regular elsewhere
let perForumModAccess: string;
let perForumModRefresh: string;
let globalAdminUserId: string;
let globalAdminAccess: string;
let globalAdminRefresh: string;

let testCategoryId: number;
let modForumTopicId: number;         // topic in modForumId, posted by regular user
let privateTopicId: number;          // topic inside privateForumId
let privatePostId: number;

// Distinctive markers. If either string appears in a response for a user who
// isn't in privGroup, content from the private forum has escaped.
//
// The term we SEARCH for is deliberately a third string: the results page
// echoes the query back ("Search found 0 matches for: ..."), so searching for
// a marker would make every assertion trivially fail on the echo rather than
// on a real leak.
const PRIVATE_TOPIC_TITLE = "PermsPrivateTopicMarkerXYZ";
const PRIVATE_POST_BODY = "PermsPrivateBodyMarkerXYZ";
const PRIVATE_SEARCH_TERM = "zebrafishquux";

async function createAndLogin(
  username: string,
  email: string,
  password: string,
  userLevel: number = 0
): Promise<{ userId: string; access: string; refresh: string }> {
  await cleanupTestUser(adminDb, username, email);
  const { data: authData, error } = await adminDb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !authData?.user) {
    throw new Error(`createUser(${email}) failed: ${error?.message ?? "no user"}`);
  }
  const userId = authData.user.id;
  await adminDb.from("profiles").insert({ id: userId, username, user_level: userLevel });

  const loginForm = new FormData();
  loginForm.append("username", username);
  loginForm.append("password", password);
  const loginRes = await app.request("/login", { method: "POST", body: loginForm });
  const cookies = loginRes.headers.getSetCookie();
  const access = cookies
    .find((c) => c.startsWith("sb-access-token="))!
    .substring("sb-access-token=".length)
    .split(";")[0];
  const refresh = cookies
    .find((c) => c.startsWith("sb-refresh-token="))!
    .substring("sb-refresh-token=".length)
    .split(";")[0];
  return { userId, access, refresh };
}

function cookies(access: string, refresh: string): HeadersInit {
  return { Cookie: `sb-access-token=${access}; sb-refresh-token=${refresh}` };
}

beforeAll(async () => {
  adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // ── Users ──────────────────────────────────────────────────
  const reg = await createAndLogin("PermsRegular", "perms-reg@plank.local", "p1", 0);
  regularUserId = reg.userId;
  regularAccess = reg.access;
  regularRefresh = reg.refresh;

  const gm = await createAndLogin("PermsGroupMember", "perms-gm@plank.local", "p1", 0);
  groupMemberUserId = gm.userId;
  groupMemberAccess = gm.access;
  groupMemberRefresh = gm.refresh;

  const pm = await createAndLogin("PermsPostMember", "perms-pm@plank.local", "p1", 0);
  postMemberUserId = pm.userId;
  postMemberAccess = pm.access;
  postMemberRefresh = pm.refresh;

  const fm = await createAndLogin("PermsForumMod", "perms-fm@plank.local", "p1", 0);
  perForumModUserId = fm.userId;
  perForumModAccess = fm.access;
  perForumModRefresh = fm.refresh;

  const adm = await createAndLogin("PermsAdmin", "perms-adm@plank.local", "p1", 1);
  globalAdminUserId = adm.userId;
  globalAdminAccess = adm.access;
  globalAdminRefresh = adm.refresh;

  // ── Category + forums ──────────────────────────────────────
  const { data: cat } = await adminDb
    .from("categories")
    .insert({ cat_title: "Perms Test Category", cat_order: 9999 })
    .select()
    .single();
  testCategoryId = cat!.id;

  const insertForum = async (name: string, overrides: Record<string, any>) => {
    const { data } = await adminDb
      .from("forums")
      .insert({
        cat_id: testCategoryId,
        forum_name: name,
        forum_desc: "",
        forum_order: 9999,
        ...overrides,
      })
      .select()
      .single();
    return data!.id as number;
  };

  // auth levels: ALL=0, REG=1, ACL=2, MOD=3, ADMIN=5
  privateForumId = await insertForum("Perms Private", { auth_view: 2, auth_read: 2 });
  postOnlyForumId = await insertForum("Perms PostOnly", { auth_view: 0, auth_read: 0, auth_post: 2 });
  modForumId = await insertForum("Perms ModForum", { auth_view: 0, auth_read: 0, auth_post: 1 });

  // ── Groups + memberships ──────────────────────────────────
  const insertGroup = async (name: string) => {
    const { data } = await adminDb
      .from("groups")
      .insert({ group_name: name, group_type: 1, group_description: "" })
      .select()
      .single();
    return data!.id as number;
  };

  privGroupId = await insertGroup("Perms PrivGroup");
  postGroupId = await insertGroup("Perms PostGroup");
  modGroupId = await insertGroup("Perms ModGroup");

  await adminDb.from("user_group").insert([
    { group_id: privGroupId, user_id: groupMemberUserId, user_pending: false },
    { group_id: postGroupId, user_id: postMemberUserId, user_pending: false },
    { group_id: modGroupId, user_id: perForumModUserId, user_pending: false },
  ]);

  // ── auth_access rows ──────────────────────────────────────
  // privGroup → can view + read privateForum
  await adminDb.from("auth_access").insert({
    group_id: privGroupId,
    forum_id: privateForumId,
    auth_view: true,
    auth_read: true,
  });
  // postGroup → can post in postOnlyForum (also implicitly view since
  // that's auth_view=ALL).
  await adminDb.from("auth_access").insert({
    group_id: postGroupId,
    forum_id: postOnlyForumId,
    auth_post: true,
    auth_reply: true,
  });
  // modGroup → mod of modForum (but not of anywhere else).
  await adminDb.from("auth_access").insert({
    group_id: modGroupId,
    forum_id: modForumId,
    auth_mod: true,
  });

  // A topic in modForum so we have something for the mod to act on.
  const { data: topic } = await adminDb
    .from("topics")
    .insert({
      forum_id: modForumId,
      topic_title: "Test Topic for Mod",
      topic_poster: regularUserId,
    })
    .select()
    .single();
  modForumTopicId = topic!.id;
  await adminDb.from("posts").insert({
    topic_id: modForumTopicId,
    forum_id: modForumId,
    poster_id: regularUserId,
  });

  // A topic + post inside the PRIVATE forum, with distinctive strings. Any
  // route that surfaces either of these to a non-member is leaking.
  const { data: privTopic } = await adminDb
    .from("topics")
    .insert({
      forum_id: privateForumId,
      topic_title: PRIVATE_TOPIC_TITLE,
      topic_poster: groupMemberUserId,
    })
    .select()
    .single();
  privateTopicId = privTopic!.id;
  const { data: privPost } = await adminDb
    .from("posts")
    .insert({
      topic_id: privateTopicId,
      forum_id: privateForumId,
      poster_id: groupMemberUserId,
    })
    .select()
    .single();
  privatePostId = privPost!.id;
  await adminDb.from("posts_text").insert({
    post_id: privatePostId,
    post_subject: PRIVATE_TOPIC_TITLE,
    post_text: `${PRIVATE_POST_BODY} ${PRIVATE_SEARCH_TERM}`,
  });
});

afterAll(async () => {
  // Children of categories/forums cascade on delete, but auth_access
  // doesn't cascade from forums (it does, on group_id and forum_id).
  // Forums delete first, then groups, then users.
  await adminDb.from("forums").delete().in("id", [privateForumId, postOnlyForumId, modForumId]);
  await adminDb.from("groups").delete().in("id", [privGroupId, postGroupId, modGroupId]);
  await adminDb.from("categories").delete().eq("id", testCategoryId);
  for (const id of [
    regularUserId,
    groupMemberUserId,
    postMemberUserId,
    perForumModUserId,
    globalAdminUserId,
  ]) {
    await adminDb.auth.admin.deleteUser(id).catch(() => {});
  }
});

describe("Per-forum ACLs: auth_view", () => {
  it("hides the private forum from the index for a guest", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).not.toContain("Perms Private");
  });

  it("hides the private forum from the index for a regular user", async () => {
    const res = await app.request("/", { headers: cookies(regularAccess, regularRefresh) });
    const html = await res.text();
    expect(html).not.toContain("Perms Private");
  });

  it("shows the private forum on the index for a member of its group", async () => {
    const res = await app.request("/", {
      headers: cookies(groupMemberAccess, groupMemberRefresh),
    });
    const html = await res.text();
    expect(html).toContain("Perms Private");
  });

  it("shows the private forum on the index for a global admin", async () => {
    const res = await app.request("/", {
      headers: cookies(globalAdminAccess, globalAdminRefresh),
    });
    const html = await res.text();
    expect(html).toContain("Perms Private");
  });

  it("returns 404 on direct viewforum URL for a guest (no existence leak)", async () => {
    const res = await app.request(`/viewforum/${privateForumId}`);
    expect(res.status).toBe(404);
  });

  it("returns 404 on direct viewforum URL for a non-member", async () => {
    const res = await app.request(`/viewforum/${privateForumId}`, {
      headers: cookies(regularAccess, regularRefresh),
    });
    expect(res.status).toBe(404);
  });

  it("allows a group member into the private forum", async () => {
    const res = await app.request(`/viewforum/${privateForumId}`, {
      headers: cookies(groupMemberAccess, groupMemberRefresh),
    });
    expect(res.status).toBe(200);
  });
});

describe("Per-forum ACLs: auth_post", () => {
  it("denies post-form GET for a user without the group bit", async () => {
    const res = await app.request(`/posting?mode=newtopic&f=${postOnlyForumId}`, {
      headers: cookies(regularAccess, regularRefresh),
    });
    expect(res.status).toBe(403);
  });

  it("allows post-form GET for a user in the posting group", async () => {
    const res = await app.request(`/posting?mode=newtopic&f=${postOnlyForumId}`, {
      headers: cookies(postMemberAccess, postMemberRefresh),
    });
    expect(res.status).toBe(200);
  });

  it("admins bypass auth_post even without group membership", async () => {
    const res = await app.request(`/posting?mode=newtopic&f=${postOnlyForumId}`, {
      headers: cookies(globalAdminAccess, globalAdminRefresh),
    });
    expect(res.status).toBe(200);
  });
});

describe("Search respects per-forum ACLs", () => {
  // Search ranges across forums rather than starting from one, so it can't
  // use the single-row gate the other routes use. Every one of its query
  // paths needs the readable-forum filter, and each is tested separately
  // because they are four independent queries that each forgot it.

  it("keyword search over post bodies hides private content from a guest", async () => {
    const res = await app.request(
      `/search?search_keywords=${PRIVATE_SEARCH_TERM}&show_results=posts`
    );
    const html = await res.text();
    expect(html).not.toContain(PRIVATE_POST_BODY);
    expect(html).not.toContain(PRIVATE_TOPIC_TITLE);
  });

  it("keyword search over post bodies hides private content from a non-member", async () => {
    const res = await app.request(
      `/search?search_keywords=${PRIVATE_SEARCH_TERM}&show_results=posts`,
      { headers: cookies(regularAccess, regularRefresh) }
    );
    const html = await res.text();
    expect(html).not.toContain(PRIVATE_POST_BODY);
  });

  it("still finds private content for a member of the forum's group", async () => {
    const res = await app.request(
      `/search?search_keywords=${PRIVATE_SEARCH_TERM}&show_results=posts`,
      { headers: cookies(groupMemberAccess, groupMemberRefresh) }
    );
    const html = await res.text();
    expect(html).toContain(PRIVATE_POST_BODY);
  });

  it("topic search hides private topic titles from a guest", async () => {
    const res = await app.request(
      `/search?search_keywords=${PRIVATE_SEARCH_TERM}&show_results=topics`
    );
    expect(await res.text()).not.toContain(PRIVATE_TOPIC_TITLE);
  });

  it("topic search still returns private topics to a member", async () => {
    const res = await app.request(
      `/search?search_keywords=${PRIVATE_SEARCH_TERM}&show_results=topics`,
      { headers: cookies(groupMemberAccess, groupMemberRefresh) }
    );
    expect(await res.text()).toContain(PRIVATE_TOPIC_TITLE);
  });

  it("explicitly targeting the private forum id returns nothing for a non-member", async () => {
    const res = await app.request(
      `/search?search_keywords=${PRIVATE_SEARCH_TERM}&forum_id=${privateForumId}&show_results=posts`,
      { headers: cookies(regularAccess, regularRefresh) }
    );
    expect(await res.text()).not.toContain(PRIVATE_POST_BODY);
  });

  it("the unanswered quick search hides private topics from a guest", async () => {
    const res = await app.request("/search?mode=unanswered");
    expect(await res.text()).not.toContain(PRIVATE_TOPIC_TITLE);
  });

  it("the new-posts quick search hides private topics from a non-member", async () => {
    const res = await app.request("/search?mode=newposts", {
      headers: cookies(regularAccess, regularRefresh),
    });
    expect(await res.text()).not.toContain(PRIVATE_TOPIC_TITLE);
  });

  it("the search form's forum dropdown omits forums the viewer cannot read", async () => {
    const res = await app.request("/search", {
      headers: cookies(regularAccess, regularRefresh),
    });
    const html = await res.text();
    expect(html).not.toContain("Perms Private");
    expect(html).toContain("Perms ModForum");
  });
});

describe("Topic review (iframe helper) respects per-forum ACLs", () => {
  it("returns 404 for a guest on a private topic", async () => {
    const res = await app.request(`/posting_topic_review?t=${privateTopicId}`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(PRIVATE_POST_BODY);
  });

  it("returns 404 for a logged-in non-member", async () => {
    const res = await app.request(`/posting_topic_review?t=${privateTopicId}`, {
      headers: cookies(regularAccess, regularRefresh),
    });
    expect(res.status).toBe(404);
  });

  it("renders for a member of the forum's group", async () => {
    const res = await app.request(`/posting_topic_review?t=${privateTopicId}`, {
      headers: cookies(groupMemberAccess, groupMemberRefresh),
    });
    expect(res.status).toBe(200);
  });

  it("renders for a topic in a public forum", async () => {
    const res = await app.request(`/posting_topic_review?t=${modForumTopicId}`);
    expect(res.status).toBe(200);
  });
});

describe("ModCP actions authorize the TARGET, not the submitted forum id", () => {
  // The POST handler gated on body.f — which only proves the user moderates
  // *some* forum — and then acted on topic ids from the body with no forum
  // predicate. Each action is tested separately because they were four
  // independent statements that each skipped the check.

  async function modcpPost(
    fields: Record<string, string>,
    access: string,
    refresh: string
  ) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return app.request("/modcp", {
      method: "POST",
      body: form,
      headers: cookies(access, refresh),
    });
  }

  it("a per-forum mod cannot delete a topic in a forum they do not moderate", async () => {
    await modcpPost(
      { f: String(modForumId), delete: "1", "topic_id_list[]": String(privateTopicId) },
      perForumModAccess,
      perForumModRefresh
    );
    const { data } = await adminDb
      .from("topics")
      .select("id")
      .eq("id", privateTopicId)
      .maybeSingle();
    expect(data).not.toBeNull();
  });

  it("a per-forum mod cannot lock a topic in a forum they do not moderate", async () => {
    await modcpPost(
      { f: String(modForumId), lock: "1", "topic_id_list[]": String(privateTopicId) },
      perForumModAccess,
      perForumModRefresh
    );
    const { data } = await adminDb
      .from("topics")
      .select("topic_status")
      .eq("id", privateTopicId)
      .maybeSingle();
    expect(data!.topic_status).toBe(0);
  });

  it("a per-forum mod cannot move a private topic into a forum they moderate", async () => {
    // This was the disclosure primitive: relocate content out of a forum you
    // cannot even view, then read it at /viewtopic.
    await modcpPost(
      {
        f: String(modForumId),
        mode: "move",
        confirm: "1",
        new_forum_id: String(modForumId),
        "topic_id_list[]": String(privateTopicId),
      },
      perForumModAccess,
      perForumModRefresh
    );
    const { data } = await adminDb
      .from("topics")
      .select("forum_id")
      .eq("id", privateTopicId)
      .maybeSingle();
    expect(data!.forum_id).toBe(privateForumId);
  });

  it("a per-forum mod cannot move their own topic into a forum they do not moderate", async () => {
    const { data: topic } = await adminDb
      .from("topics")
      .insert({
        forum_id: modForumId,
        topic_title: "Mod forum topic to move out",
        topic_poster: regularUserId,
      })
      .select()
      .single();

    await modcpPost(
      {
        f: String(modForumId),
        mode: "move",
        confirm: "1",
        new_forum_id: String(privateForumId),
        "topic_id_list[]": String(topic!.id),
      },
      perForumModAccess,
      perForumModRefresh
    );

    const { data: after } = await adminDb
      .from("topics")
      .select("forum_id")
      .eq("id", topic!.id)
      .maybeSingle();
    expect(after!.forum_id).toBe(modForumId);
    await adminDb.from("topics").delete().eq("id", topic!.id);
  });

  it("a per-forum mod CAN still lock a topic in their own forum", async () => {
    const { data: topic } = await adminDb
      .from("topics")
      .insert({
        forum_id: modForumId,
        topic_title: "Lockable topic",
        topic_poster: regularUserId,
      })
      .select()
      .single();

    await modcpPost(
      { f: String(modForumId), lock: "1", "topic_id_list[]": String(topic!.id) },
      perForumModAccess,
      perForumModRefresh
    );

    const { data: after } = await adminDb
      .from("topics")
      .select("topic_status")
      .eq("id", topic!.id)
      .maybeSingle();
    expect(after!.topic_status).toBe(1);
    await adminDb.from("topics").delete().eq("id", topic!.id);
  });

  it("a global admin can still act across forums", async () => {
    const { data: topic } = await adminDb
      .from("topics")
      .insert({
        forum_id: privateForumId,
        topic_title: "Admin-lockable topic",
        topic_poster: regularUserId,
      })
      .select()
      .single();

    await modcpPost(
      { f: String(privateForumId), lock: "1", "topic_id_list[]": String(topic!.id) },
      globalAdminAccess,
      globalAdminRefresh
    );

    const { data: after } = await adminDb
      .from("topics")
      .select("topic_status")
      .eq("id", topic!.id)
      .maybeSingle();
    expect(after!.topic_status).toBe(1);
    await adminDb.from("topics").delete().eq("id", topic!.id);
  });
});

describe("Per-forum mod (auth_mod bit)", () => {
  it("per-forum mod can access modcp for their forum", async () => {
    const res = await app.request(`/modcp?f=${modForumId}`, {
      headers: cookies(perForumModAccess, perForumModRefresh),
    });
    expect(res.status).toBe(200);
  });

  it("per-forum mod CANNOT access modcp for a different forum", async () => {
    const res = await app.request(`/modcp?f=${postOnlyForumId}`, {
      headers: cookies(perForumModAccess, perForumModRefresh),
    });
    expect(res.status).toBe(403);
  });

  it("regular user cannot access modcp", async () => {
    const res = await app.request(`/modcp?f=${modForumId}`, {
      headers: cookies(regularAccess, regularRefresh),
    });
    expect(res.status).toBe(403);
  });

  it("global admin can access modcp anywhere", async () => {
    const res = await app.request(`/modcp?f=${modForumId}`, {
      headers: cookies(globalAdminAccess, globalAdminRefresh),
    });
    expect(res.status).toBe(200);
  });
});
