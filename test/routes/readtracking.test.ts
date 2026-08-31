import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";
import { cleanupTestUser } from "../util/users.js";
import {
  loadReadState,
  isTopicUnread,
  isForumUnread,
  GUEST_READ_STATE,
} from "../../src/lib/readtracking.js";

/**
 * Per-user read tracking (Chunk 18). The folder icons rendered "no new posts"
 * unconditionally and /markread was a redirect, so this covers the whole
 * feature: the watermark logic, and that the pages actually reflect it.
 */

config({ path: ".env" });

let adminDb: SupabaseClient;
let categoryId: number;
let forumId: number;
let topicId: number;
let userId: string, access: string, refresh: string;

// The "jump to newest post" link, which is emitted ONLY on an unread row.
// folder_new.gif would be the obvious marker but the template also renders it
// as a legend key on every page, read or not — so asserting on it would pass
// unconditionally.
const UNREAD_MARKER = "icon_newest_reply.gif";

async function login(username: string, password: string) {
  const form = new FormData();
  form.append("username", username);
  form.append("password", password);
  const res = await app.request("/login", { method: "POST", body: form });
  const cookies = res.headers.getSetCookie();
  return {
    access: cookies
      .find((c) => c.startsWith("sb-access-token="))!
      .substring("sb-access-token=".length)
      .split(";")[0],
    refresh: cookies
      .find((c) => c.startsWith("sb-refresh-token="))!
      .substring("sb-refresh-token=".length)
      .split(";")[0],
  };
}

function as(): HeadersInit {
  return { Cookie: `sb-access-token=${access}; sb-refresh-token=${refresh}` };
}

beforeAll(async () => {
  adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  await cleanupTestUser(adminDb, "ReadTracker", "readtracker@plank.local");
  const { data } = await adminDb.auth.admin.createUser({
    email: "readtracker@plank.local",
    password: "read-pass-1234",
    email_confirm: true,
  });
  userId = data.user!.id;
  await adminDb.from("profiles").insert({ id: userId, username: "ReadTracker" });
  ({ access, refresh } = await login("ReadTracker", "read-pass-1234"));

  const { data: cat } = await adminDb
    .from("categories")
    .insert({ cat_title: "Read Category", cat_order: 9996 })
    .select()
    .single();
  categoryId = cat!.id;

  const { data: forum } = await adminDb
    .from("forums")
    .insert({
      cat_id: categoryId,
      forum_name: "Read Forum",
      forum_desc: "",
      forum_order: 9996,
    })
    .select()
    .single();
  forumId = forum!.id;

  const { data: topic } = await adminDb
    .from("topics")
    .insert({
      forum_id: forumId,
      topic_title: "ReadTrackingTopic",
      topic_poster: userId,
    })
    .select()
    .single();
  topicId = topic!.id;

  const { data: post } = await adminDb
    .from("posts")
    .insert({ topic_id: topicId, forum_id: forumId, poster_id: userId })
    .select()
    .single();
  await adminDb
    .from("posts_text")
    .insert({ post_id: post!.id, post_subject: "t", post_text: "body" });
});

afterAll(async () => {
  await adminDb.from("forums").delete().eq("id", forumId);
  await adminDb.from("categories").delete().eq("id", categoryId);
  await adminDb.auth.admin.deleteUser(userId).catch(() => {});
});

describe("watermark logic", () => {
  const state = {
    topics: new Map([[1, Date.parse("2026-03-10T00:00:00Z")]]),
    forums: new Map([[7, Date.parse("2026-03-12T00:00:00Z")]]),
    boardMark: Date.parse("2026-03-05T00:00:00Z"),
  };

  it("is unread when the last post is newer than every watermark", () => {
    expect(isTopicUnread(state, 1, 99, "2026-03-11T00:00:00Z")).toBe(true);
  });

  it("is read when the topic itself was opened later", () => {
    expect(isTopicUnread(state, 1, 99, "2026-03-09T00:00:00Z")).toBe(false);
  });

  it("a forum-level mark covers topics with no row of their own", () => {
    expect(isTopicUnread(state, 42, 7, "2026-03-11T00:00:00Z")).toBe(false);
    expect(isTopicUnread(state, 42, 7, "2026-03-13T00:00:00Z")).toBe(true);
  });

  it("a board-level mark covers everything older", () => {
    expect(isTopicUnread(state, 999, 999, "2026-03-04T00:00:00Z")).toBe(false);
    expect(isTopicUnread(state, 999, 999, "2026-03-06T00:00:00Z")).toBe(true);
  });

  it("a topic with no posts is never unread", () => {
    expect(isTopicUnread(state, 1, 7, null)).toBe(false);
  });

  it("nothing is unread for a guest", () => {
    expect(isTopicUnread(GUEST_READ_STATE, 1, 1, "2030-01-01T00:00:00Z")).toBe(false);
    expect(isForumUnread(GUEST_READ_STATE, 1, "2030-01-01T00:00:00Z")).toBe(false);
  });

  it("loads an empty state for a guest without querying", async () => {
    const state = await loadReadState(adminDb, null, { topicIds: [1] });
    expect(state).toBe(GUEST_READ_STATE);
  });
});

describe("the topic list reflects read state", () => {
  it("shows a topic as unread before it has been opened", async () => {
    const html = await (
      await app.request(`/viewforum/${forumId}`, { headers: as() })
    ).text();
    expect(html).toContain(UNREAD_MARKER);
    expect(html).toContain("New posts");
  });

  it("shows it as read after viewing it", async () => {
    await app.request(`/viewtopic/${topicId}`, { headers: as() });

    const { data } = await adminDb
      .from("topics_read")
      .select("topic_id")
      .eq("user_id", userId)
      .eq("topic_id", topicId)
      .maybeSingle();
    expect(data).not.toBeNull();

    const html = await (
      await app.request(`/viewforum/${forumId}`, { headers: as() })
    ).text();
    expect(html).not.toContain(UNREAD_MARKER);
  });

  it("goes unread again when someone posts a reply", async () => {
    // Deliberately no future timestamps: a post dated ahead of now can never
    // be marked read, which would make the /markread tests below unfixable.
    // Instead the reply is 10 minutes old and the read watermark is rewound
    // an hour, so the ordering is explicit rather than dependent on clock
    // resolution.
    const { data: post } = await adminDb
      .from("posts")
      .insert({
        topic_id: topicId,
        forum_id: forumId,
        poster_id: userId,
        post_time: new Date(Date.now() - 10 * 60_000).toISOString(),
      })
      .select()
      .single();
    await adminDb
      .from("posts_text")
      .insert({ post_id: post!.id, post_subject: "re", post_text: "reply" });
    await adminDb
      .from("topics_read")
      .update({ read_time: new Date(Date.now() - 60 * 60_000).toISOString() })
      .eq("user_id", userId)
      .eq("topic_id", topicId);

    const html = await (
      await app.request(`/viewforum/${forumId}`, { headers: as() })
    ).text();
    expect(html).toContain(UNREAD_MARKER);
  });

  it("never shows unread icons to a guest", async () => {
    const html = await (await app.request(`/viewforum/${forumId}`)).text();
    expect(html).not.toContain(UNREAD_MARKER);
  });
});

describe("/markread", () => {
  async function markReadUrl(query: string): Promise<Response> {
    // The link carries the token; scrape it from the page that renders it.
    const page = await app.request("/", { headers: as() });
    const html = await page.text();
    const token = html.match(/\/markread\?(?:f=\d+&)?_csrf=([a-f0-9]+)/)?.[1];
    expect(token, "no tokenised markread link on the index").toBeTruthy();
    return app.request(`/markread?${query}${query ? "&" : ""}_csrf=${token}`, {
      headers: as(),
    });
  }

  it("marks a single forum read", async () => {
    const res = await markReadUrl(`f=${forumId}`);
    expect(res.status).toBe(302);

    const { data } = await adminDb
      .from("forums_read")
      .select("forum_id")
      .eq("user_id", userId)
      .eq("forum_id", forumId)
      .maybeSingle();
    expect(data).not.toBeNull();

    const html = await (
      await app.request(`/viewforum/${forumId}`, { headers: as() })
    ).text();
    expect(html).not.toContain(UNREAD_MARKER);
  });

  it("marks the whole board read and prunes the now-redundant rows", async () => {
    // Make it unread again by rewinding every watermark behind the existing
    // posts, rather than dating a post into the future.
    const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    await adminDb
      .from("topics_read")
      .update({ read_time: hourAgo })
      .eq("user_id", userId);
    await adminDb
      .from("forums_read")
      .update({ read_time: hourAgo })
      .eq("user_id", userId);
    await adminDb
      .from("profiles")
      .update({ user_lastmark: null })
      .eq("id", userId);

    const res = await markReadUrl("");
    expect(res.status).toBe(302);

    const { data: profile } = await adminDb
      .from("profiles")
      .select("user_lastmark")
      .eq("id", userId)
      .maybeSingle();
    expect(profile!.user_lastmark).toBeTruthy();

    // The per-topic/per-forum rows can no longer change an answer.
    const { data: leftover } = await adminDb
      .from("topics_read")
      .select("topic_id")
      .eq("user_id", userId);
    expect(leftover ?? []).toHaveLength(0);
  });

  // Token rejection can't be asserted here: vitest.config sets SKIP_CSRF=1
  // for the whole suite, so validateQueryCsrf always passes. It's covered in
  // test/security/invariants.test.ts, which runs the real middleware.

  it("sends a guest to the index rather than erroring", async () => {
    const res = await app.request("/markread");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });
});
