import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";

config({ path: ".env" });

let adminDb: SupabaseClient;
let testUserId: string;
let testTopicId: number;
let testPostId: number;
let testForumId: number;

beforeAll(async () => {
  adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Create test user
  const { data: authData } = await adminDb.auth.admin.createUser({
    email: "topictest@plank.local",
    password: "testpass",
    email_confirm: true,
  });
  testUserId = authData.user!.id;
  await adminDb.from("profiles").insert({
    id: testUserId,
    username: "TopicTester",
    user_sig: "[i]My signature[/i]",
    user_from: "The Internet",
  });

  // Get forum
  const { data: forum } = await adminDb
    .from("forums")
    .select("id")
    .limit(1)
    .single();
  testForumId = forum!.id;

  // Create topic
  const { data: topic } = await adminDb
    .from("topics")
    .insert({
      forum_id: testForumId,
      topic_title: "BBCode Test Topic",
      topic_poster: testUserId,
    })
    .select()
    .single();
  testTopicId = topic!.id;

  // Create a post with BBCode
  const { data: post } = await adminDb
    .from("posts")
    .insert({
      topic_id: testTopicId,
      forum_id: testForumId,
      poster_id: testUserId,
      enable_sig: true,
      enable_smilies: true,
    })
    .select()
    .single();
  testPostId = post!.id;

  await adminDb.from("posts_text").insert({
    post_id: testPostId,
    post_subject: "BBCode Test Topic",
    post_text: "[b]Hello World[/b]\n\nThis is a [i]test[/i] post with [url=https://example.com]a link[/url] :)",
  });

  // Update topic references
  await adminDb
    .from("topics")
    .update({
      topic_first_post_id: testPostId,
      topic_last_post_id: testPostId,
    })
    .eq("id", testTopicId);
});

afterAll(async () => {
  await adminDb.from("topics").delete().eq("id", testTopicId);
  await adminDb.auth.admin.deleteUser(testUserId);
});

describe("View Topic", () => {
  it("renders a topic with posts", async () => {
    const res = await app.request(`/viewtopic/${testTopicId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("BBCode Test Topic");
    expect(html).toContain("TopicTester");
  });

  it("renders BBCode in posts", async () => {
    const res = await app.request(`/viewtopic/${testTopicId}`);
    const html = await res.text();
    expect(html).toContain("<strong>Hello World</strong>");
    expect(html).toContain("<em>test</em>");
    expect(html).toContain('href="https://example.com"');
  });

  it("renders smilies in posts", async () => {
    const res = await app.request(`/viewtopic/${testTopicId}`);
    const html = await res.text();
    expect(html).toContain("icon_smile.gif");
  });

  it("renders user signature", async () => {
    const res = await app.request(`/viewtopic/${testTopicId}`);
    const html = await res.text();
    expect(html).toContain("<em>My signature</em>");
  });

  it("displays author information", async () => {
    const res = await app.request(`/viewtopic/${testTopicId}`);
    const html = await res.text();
    expect(html).toContain("TopicTester");
    expect(html).toContain("The Internet");
    expect(html).toContain("Posts:");
  });

  it("displays user rank", async () => {
    const res = await app.request(`/viewtopic/${testTopicId}`);
    const html = await res.text();
    expect(html).toContain("New Member");
  });

  it("increments view count", async () => {
    const { data: before } = await adminDb
      .from("topics")
      .select("topic_views")
      .eq("id", testTopicId)
      .single();

    await app.request(`/viewtopic/${testTopicId}`);

    const { data: after } = await adminDb
      .from("topics")
      .select("topic_views")
      .eq("id", testTopicId)
      .single();

    expect(after!.topic_views).toBeGreaterThan(before!.topic_views);
  });

  it("returns 404 for nonexistent topic", async () => {
    const res = await app.request("/viewtopic/99999");
    expect(res.status).toBe(404);
  });

  it("shows breadcrumbs with forum link", async () => {
    const res = await app.request(`/viewtopic/${testTopicId}`);
    const html = await res.text();
    expect(html).toContain(`/viewforum/${testForumId}`);
    expect(html).toContain("Index");
  });
});
