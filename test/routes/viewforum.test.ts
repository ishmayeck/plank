import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";
import { cleanupTestUser } from "../util/users.js";

config({ path: ".env" });

let adminDb: SupabaseClient;
const cleanupIds: { users: string[]; topics: number[] } = {
  users: [],
  topics: [],
};

beforeAll(async () => {
  adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // supabase db reset doesn't truncate auth.users — defend against
  // leftover state from prior runs so createUser doesn't return null.
  await cleanupTestUser(adminDb, "ForumTester", "forumtest@plank.local");

  // Create a test user and some topics
  const { data: authData, error: authErr } = await adminDb.auth.admin.createUser({
    email: "forumtest@plank.local",
    password: "testpass",
    email_confirm: true,
  });
  if (authErr || !authData?.user) {
    throw new Error(`createUser failed: ${authErr?.message ?? "no user returned"}`);
  }
  const userId = authData.user.id;
  cleanupIds.users.push(userId);

  await adminDb.from("profiles").insert({
    id: userId,
    username: "ForumTester",
  });

  // Get first forum (ordered, so previous test files that added/removed
  // forums don't change which one we land on).
  const { data: forum } = await adminDb
    .from("forums")
    .select("id")
    .order("id", { ascending: true })
    .limit(1)
    .single();

  // Create a few topics
  for (let i = 1; i <= 3; i++) {
    const { data: topic } = await adminDb
      .from("topics")
      .insert({
        forum_id: forum!.id,
        topic_title: `Test Topic ${i}`,
        topic_poster: userId,
        topic_type: i === 1 ? 1 : 0, // First is sticky
      })
      .select()
      .single();

    if (topic) {
      cleanupIds.topics.push(topic.id);

      // Create a post for the topic
      const { data: post } = await adminDb
        .from("posts")
        .insert({
          topic_id: topic.id,
          forum_id: forum!.id,
          poster_id: userId,
        })
        .select()
        .single();

      if (post) {
        await adminDb.from("posts_text").insert({
          post_id: post.id,
          post_subject: `Test Topic ${i}`,
          post_text: `This is test topic ${i}`,
        });

        // Update topic first/last post
        await adminDb
          .from("topics")
          .update({
            topic_first_post_id: post.id,
            topic_last_post_id: post.id,
          })
          .eq("id", topic.id);
      }
    }
  }
});

afterAll(async () => {
  // Clean up in reverse order
  for (const topicId of cleanupIds.topics) {
    await adminDb.from("topics").delete().eq("id", topicId);
  }
  for (const userId of cleanupIds.users) {
    await adminDb.auth.admin.deleteUser(userId);
  }
});

describe("View Forum", () => {
  it("renders a forum with topics", async () => {
    const { data: forum } = await adminDb
      .from("forums")
      .select("id")
      .order("id", { ascending: true })
      .limit(1)
      .single();

    const res = await app.request(`/viewforum/${forum!.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Test Topic");
    expect(html).toContain("ForumTester");
    expect(html).toContain("Topics");
    expect(html).toContain("Replies");
  });

  it("shows sticky topics with type indicator", async () => {
    const { data: forum } = await adminDb
      .from("forums")
      .select("id")
      .order("id", { ascending: true })
      .limit(1)
      .single();

    const res = await app.request(`/viewforum/${forum!.id}`);
    const html = await res.text();
    expect(html).toContain("<b>Sticky:</b>");
  });

  it("returns 404 for nonexistent forum", async () => {
    const res = await app.request("/viewforum/99999");
    expect(res.status).toBe(404);
  });

  it("shows empty message when no topics", async () => {
    // Create empty forum
    const { data: cat } = await adminDb
      .from("categories")
      .select("id")
      .limit(1)
      .single();

    const { data: emptyForum } = await adminDb
      .from("forums")
      .insert({
        cat_id: cat!.id,
        forum_name: "Empty Forum",
        forum_order: 99,
      })
      .select()
      .single();

    const res = await app.request(`/viewforum/${emptyForum!.id}`);
    const html = await res.text();
    expect(html).toContain("no topics");

    // Cleanup
    await adminDb.from("forums").delete().eq("id", emptyForum!.id);
  });
});
