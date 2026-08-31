import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";
import { cleanupTestUser } from "../util/users.js";
import { getWatchState, watchedTopicIds } from "../../src/lib/watch.js";

/**
 * Topic watching (Chunk 18). The topics_watch table shipped with the initial
 * schema and nothing read or wrote it until now.
 *
 * Watching is in-board rather than email — see src/lib/watch.ts for why —
 * so what's asserted here is the subscription, the notify flag being raised
 * for other watchers when a reply lands, and the watched-topics view.
 */

config({ path: ".env" });

let adminDb: SupabaseClient;
let categoryId: number;
let forumId: number;
let privateForumId: number;
let topicId: number;
let privateTopicId: number;

let alice = { id: "", access: "", refresh: "" };
let bob = { id: "", access: "", refresh: "" };

async function createAndLogin(username: string, email: string) {
  await cleanupTestUser(adminDb, username, email);
  const { data } = await adminDb.auth.admin.createUser({
    email,
    password: "watch-pass-1234",
    email_confirm: true,
  });
  const id = data.user!.id;
  await adminDb.from("profiles").insert({ id, username });
  const form = new FormData();
  form.append("username", username);
  form.append("password", "watch-pass-1234");
  const res = await app.request("/login", { method: "POST", body: form });
  const cookies = res.headers.getSetCookie();
  return {
    id,
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

function as(u: { access: string; refresh: string }): HeadersInit {
  return { Cookie: `sb-access-token=${u.access}; sb-refresh-token=${u.refresh}` };
}

/** Follow the watch link the page renders, so the token comes from the app. */
async function clickWatch(
  u: { access: string; refresh: string },
  action: "topic" | "unwatch"
): Promise<Response> {
  const html = await (
    await app.request(`/viewtopic/${topicId}`, { headers: as(u) })
  ).text();
  const token = html.match(/watch=(?:topic|unwatch)&amp;_csrf=([a-f0-9]+)/)?.[1];
  expect(token, "no watch link rendered").toBeTruthy();
  return app.request(`/viewtopic/${topicId}?watch=${action}&_csrf=${token}`, {
    headers: as(u),
  });
}

beforeAll(async () => {
  adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  alice = await createAndLogin("WatchAlice", "watch-alice@plank.local");
  bob = await createAndLogin("WatchBob", "watch-bob@plank.local");

  const { data: cat } = await adminDb
    .from("categories")
    .insert({ cat_title: "Watch Category", cat_order: 9995 })
    .select()
    .single();
  categoryId = cat!.id;

  const mk = async (name: string, overrides: Record<string, any> = {}) => {
    const { data } = await adminDb
      .from("forums")
      .insert({
        cat_id: categoryId,
        forum_name: name,
        forum_desc: "",
        forum_order: 9995,
        ...overrides,
      })
      .select()
      .single();
    return data!.id as number;
  };
  forumId = await mk("Watch Forum");
  privateForumId = await mk("Watch Private", { auth_view: 2, auth_read: 2 });

  const mkTopic = async (fid: number, title: string) => {
    const { data: topic } = await adminDb
      .from("topics")
      .insert({ forum_id: fid, topic_title: title, topic_poster: alice.id })
      .select()
      .single();
    const { data: post } = await adminDb
      .from("posts")
      .insert({ topic_id: topic!.id, forum_id: fid, poster_id: alice.id })
      .select()
      .single();
    await adminDb
      .from("posts_text")
      .insert({ post_id: post!.id, post_subject: title, post_text: "body" });
    return topic!.id as number;
  };
  topicId = await mkTopic(forumId, "WatchableTopic");
  privateTopicId = await mkTopic(privateForumId, "PrivateWatchedTopic");
});

afterAll(async () => {
  await adminDb.from("forums").delete().in("id", [forumId, privateForumId]);
  await adminDb.from("categories").delete().eq("id", categoryId);
  for (const u of [alice, bob]) {
    await adminDb.auth.admin.deleteUser(u.id).catch(() => {});
  }
});

describe("watching a topic", () => {
  it("offers a watch link to a logged-in reader", async () => {
    const html = await (
      await app.request(`/viewtopic/${topicId}`, { headers: as(alice) })
    ).text();
    expect(html).toContain("Watch this topic");
  });

  it("offers nothing to a guest", async () => {
    const html = await (await app.request(`/viewtopic/${topicId}`)).text();
    expect(html).not.toContain("Watch this topic");
    expect(html).not.toContain("Stop watching");
  });

  it("subscribes, and then offers to unsubscribe", async () => {
    await clickWatch(alice, "topic");

    const state = await getWatchState(adminDb, alice.id, topicId);
    expect(state.watching).toBe(true);

    const html = await (
      await app.request(`/viewtopic/${topicId}`, { headers: as(alice) })
    ).text();
    expect(html).toContain("Stop watching this topic");
  });

  it("is idempotent — watching twice is not an error", async () => {
    await clickWatch(alice, "topic");
    expect((await getWatchState(adminDb, alice.id, topicId)).watching).toBe(true);
  });

  it("unsubscribes", async () => {
    await clickWatch(alice, "unwatch");
    expect((await getWatchState(adminDb, alice.id, topicId)).watching).toBe(false);
  });
});

describe("reply notifications", () => {
  it("flags other watchers, but not the person who replied", async () => {
    await clickWatch(alice, "topic");
    await clickWatch(bob, "topic");

    const form = new FormData();
    form.append("mode", "reply");
    form.append("topic_id", String(topicId));
    form.append("message", "a reply from bob");
    form.append("subject", "Re: WatchableTopic");
    await app.request("/posting", {
      method: "POST",
      body: form,
      headers: as(bob),
    });

    expect((await getWatchState(adminDb, alice.id, topicId)).notify).toBe(true);
    // Bob wrote it — telling him about it would be noise.
    expect((await getWatchState(adminDb, bob.id, topicId)).notify).toBe(false);
  });

  it("clears the flag once the watcher looks at the topic", async () => {
    await app.request(`/viewtopic/${topicId}`, { headers: as(alice) });
    expect((await getWatchState(adminDb, alice.id, topicId)).notify).toBe(false);
  });
});

describe("the watched-topics view", () => {
  it("lists what the user watches", async () => {
    const html = await (
      await app.request("/search?mode=watched", { headers: as(alice) })
    ).text();
    expect(html).toContain("WatchableTopic");
    expect(html).toContain("Topics you are watching");
  });

  it("does not list another user's subscriptions", async () => {
    await clickWatch(alice, "unwatch");
    const html = await (
      await app.request("/search?mode=watched", { headers: as(alice) })
    ).text();
    expect(html).not.toContain("WatchableTopic");

    // Bob still watches it.
    expect(await watchedTopicIds(adminDb, bob.id)).toContain(topicId);
  });

  it("still applies forum permissions to watched topics", async () => {
    // Watching does not grant access, and a forum's permissions can change
    // after someone subscribes.
    await adminDb
      .from("topics_watch")
      .insert({ topic_id: privateTopicId, user_id: bob.id, notify_status: false });

    const html = await (
      await app.request("/search?mode=watched", { headers: as(bob) })
    ).text();
    expect(html).not.toContain("PrivateWatchedTopic");
  });
});
