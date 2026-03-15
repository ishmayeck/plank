import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";

config({ path: ".env" });

let adminDb: SupabaseClient;
let testUserId: string;
let testForumId: number;
let accessToken: string;
let refreshToken: string;

// Track resources for cleanup
const createdTopicIds: number[] = [];

beforeAll(async () => {
  adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Clean up any leftover test user from previous runs
  const { data: existingProfile } = await adminDb
    .from("profiles")
    .select("id")
    .eq("username", "PostingTester")
    .single();
  if (existingProfile) {
    await adminDb.from("topics").delete().eq("topic_poster", existingProfile.id);
    await adminDb.auth.admin.deleteUser(existingProfile.id);
  }

  // Create test user
  const { data: authData } = await adminDb.auth.admin.createUser({
    email: "postingtest@plank.local",
    password: "testpass123",
    email_confirm: true,
  });
  testUserId = authData.user!.id;
  await adminDb.from("profiles").insert({
    id: testUserId,
    username: "PostingTester",
  });

  // Get a forum to post in
  const { data: forum } = await adminDb
    .from("forums")
    .select("id")
    .limit(1)
    .single();
  testForumId = forum!.id;

  // Sign in through the app to get proper session cookies
  const loginForm = new FormData();
  loginForm.append("username", "PostingTester");
  loginForm.append("password", "testpass123");
  const loginRes = await app.request("/login", {
    method: "POST",
    body: loginForm,
  });
  const cookies = loginRes.headers.getSetCookie();
  const accessCookie = cookies.find((c) => c.startsWith("sb-access-token="));
  const refreshCookie = cookies.find((c) => c.startsWith("sb-refresh-token="));
  accessToken = accessCookie!.substring("sb-access-token=".length).split(";")[0];
  refreshToken = refreshCookie!.substring("sb-refresh-token=".length).split(";")[0];
});

afterAll(async () => {
  // Clean up created topics (cascade deletes posts)
  for (const topicId of createdTopicIds) {
    await adminDb.from("topics").delete().eq("id", topicId);
  }
  await adminDb.auth.admin.deleteUser(testUserId);
});

function authHeaders(): HeadersInit {
  return {
    Cookie: `sb-access-token=${accessToken}; sb-refresh-token=${refreshToken}`,
  };
}

describe("Posting", () => {
  describe("authentication", () => {
    it("redirects to login when not authenticated", async () => {
      const res = await app.request("/posting?mode=newtopic&f=1");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });
  });

  describe("GET /posting - new topic form", () => {
    it("renders the new topic form", async () => {
      const res = await app.request(
        `/posting?mode=newtopic&f=${testForumId}`,
        { headers: authHeaders() }
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Post a new topic");
      expect(html).toContain("Subject");
      expect(html).toContain("Message body");
      expect(html).toContain('name="mode" value="newtopic"');
    });
  });

  describe("POST /posting - create new topic", () => {
    it("creates a new topic and redirects", async () => {
      const formData = new FormData();
      formData.append("mode", "newtopic");
      formData.append("forum_id", String(testForumId));
      formData.append("subject", "Test New Topic");
      formData.append("message", "[b]Hello from the test![/b]");
      formData.append("attach_sig", "on");

      const res = await app.request("/posting", {
        method: "POST",
        body: formData,
        headers: authHeaders(),
      });

      expect(res.status).toBe(302);
      const location = res.headers.get("location")!;
      expect(location).toMatch(/\/viewtopic\/\d+/);

      // Extract topic ID for cleanup
      const topicId = parseInt(location.match(/\/viewtopic\/(\d+)/)![1], 10);
      createdTopicIds.push(topicId);

      // Verify the topic was actually created
      const { data: topic } = await adminDb
        .from("topics")
        .select("*")
        .eq("id", topicId)
        .single();
      expect(topic).not.toBeNull();
      expect(topic!.topic_title).toBe("Test New Topic");
      expect(topic!.topic_poster).toBe(testUserId);

      // Verify the post text
      const { data: post } = await adminDb
        .from("posts")
        .select("*, posts_text(*)")
        .eq("topic_id", topicId)
        .single();
      expect(post).not.toBeNull();
      expect(post!.posts_text.post_text).toBe("[b]Hello from the test![/b]");
      expect(post!.posts_text.post_text_html).toContain("<strong>Hello from the test!</strong>");
    });

    it("rejects empty message", async () => {
      const formData = new FormData();
      formData.append("mode", "newtopic");
      formData.append("forum_id", String(testForumId));
      formData.append("subject", "Empty Topic");
      formData.append("message", "   ");

      const res = await app.request("/posting", {
        method: "POST",
        body: formData,
        headers: authHeaders(),
      });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("You must enter a message when posting");
    });

    it("rejects missing subject for new topic", async () => {
      const formData = new FormData();
      formData.append("mode", "newtopic");
      formData.append("forum_id", String(testForumId));
      formData.append("subject", "");
      formData.append("message", "Has a message but no subject");

      const res = await app.request("/posting", {
        method: "POST",
        body: formData,
        headers: authHeaders(),
      });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Subject must not be empty");
    });
  });

  describe("POST /posting - reply", () => {
    let replyTopicId: number;

    beforeAll(async () => {
      // Create a topic to reply to
      const { data: topic } = await adminDb
        .from("topics")
        .insert({
          forum_id: testForumId,
          topic_title: "Topic For Replies",
          topic_poster: testUserId,
        })
        .select()
        .single();
      replyTopicId = topic!.id;
      createdTopicIds.push(replyTopicId);

      const { data: post } = await adminDb
        .from("posts")
        .insert({
          topic_id: replyTopicId,
          forum_id: testForumId,
          poster_id: testUserId,
        })
        .select()
        .single();

      await adminDb.from("posts_text").insert({
        post_id: post!.id,
        post_subject: "Topic For Replies",
        post_text: "Original post",
      });

      await adminDb
        .from("topics")
        .update({
          topic_first_post_id: post!.id,
          topic_last_post_id: post!.id,
        })
        .eq("id", replyTopicId);
    });

    it("renders reply form", async () => {
      const res = await app.request(
        `/posting?mode=reply&t=${replyTopicId}`,
        { headers: authHeaders() }
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Post a reply");
      expect(html).toContain("Re: Topic For Replies");
    });

    it("creates a reply and redirects to topic", async () => {
      const formData = new FormData();
      formData.append("mode", "reply");
      formData.append("forum_id", String(testForumId));
      formData.append("topic_id", String(replyTopicId));
      formData.append("subject", "Re: Topic For Replies");
      formData.append("message", "This is a reply!");

      const res = await app.request("/posting", {
        method: "POST",
        body: formData,
        headers: authHeaders(),
      });

      expect(res.status).toBe(302);
      const location = res.headers.get("location")!;
      expect(location).toContain(`/viewtopic/${replyTopicId}`);

      // Verify reply count updated
      const { data: topic } = await adminDb
        .from("topics")
        .select("topic_replies")
        .eq("id", replyTopicId)
        .single();
      expect(topic!.topic_replies).toBe(1);
    });
  });

  describe("POST /posting - edit", () => {
    let editPostId: number;
    let editTopicId: number;

    beforeAll(async () => {
      // Create a topic+post to edit
      const { data: topic } = await adminDb
        .from("topics")
        .insert({
          forum_id: testForumId,
          topic_title: "Topic To Edit",
          topic_poster: testUserId,
        })
        .select()
        .single();
      editTopicId = topic!.id;
      createdTopicIds.push(editTopicId);

      const { data: post } = await adminDb
        .from("posts")
        .insert({
          topic_id: editTopicId,
          forum_id: testForumId,
          poster_id: testUserId,
        })
        .select()
        .single();
      editPostId = post!.id;

      await adminDb.from("posts_text").insert({
        post_id: editPostId,
        post_subject: "Topic To Edit",
        post_text: "Original text",
      });

      await adminDb
        .from("topics")
        .update({
          topic_first_post_id: editPostId,
          topic_last_post_id: editPostId,
        })
        .eq("id", editTopicId);
    });

    it("renders edit form with existing content", async () => {
      const res = await app.request(
        `/posting?mode=editpost&p=${editPostId}`,
        { headers: authHeaders() }
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Edit post");
      expect(html).toContain("Original text");
    });

    it("updates the post content", async () => {
      const formData = new FormData();
      formData.append("mode", "editpost");
      formData.append("post_id", String(editPostId));
      formData.append("forum_id", String(testForumId));
      formData.append("topic_id", String(editTopicId));
      formData.append("subject", "Topic To Edit - Edited");
      formData.append("message", "Updated text");

      const res = await app.request("/posting", {
        method: "POST",
        body: formData,
        headers: authHeaders(),
      });

      expect(res.status).toBe(302);

      // Verify the post was updated
      const { data: postText } = await adminDb
        .from("posts_text")
        .select("post_text, post_subject")
        .eq("post_id", editPostId)
        .single();
      expect(postText!.post_text).toBe("Updated text");
      expect(postText!.post_subject).toBe("Topic To Edit - Edited");

      // Verify edit count incremented
      const { data: post } = await adminDb
        .from("posts")
        .select("post_edit_count")
        .eq("id", editPostId)
        .single();
      expect(post!.post_edit_count).toBe(1);
    });
  });

  describe("POST /posting - preview", () => {
    it("renders preview without creating a post", async () => {
      const formData = new FormData();
      formData.append("mode", "newtopic");
      formData.append("forum_id", String(testForumId));
      formData.append("subject", "Preview Subject");
      formData.append("message", "[b]Bold preview[/b]");
      formData.append("preview", "1");

      const res = await app.request("/posting", {
        method: "POST",
        body: formData,
        headers: authHeaders(),
      });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Preview");
      expect(html).toContain("<strong>Bold preview</strong>");
      // Should preserve form values
      expect(html).toContain("Preview Subject");
      expect(html).toContain("[b]Bold preview[/b]");
    });
  });

  describe("POST /posting - delete", () => {
    it("deletes a reply post and redirects to topic", async () => {
      // Create topic with two posts
      const { data: topic } = await adminDb
        .from("topics")
        .insert({
          forum_id: testForumId,
          topic_title: "Topic With Delete",
          topic_poster: testUserId,
        })
        .select()
        .single();
      createdTopicIds.push(topic!.id);

      const { data: firstPost } = await adminDb
        .from("posts")
        .insert({
          topic_id: topic!.id,
          forum_id: testForumId,
          poster_id: testUserId,
        })
        .select()
        .single();

      await adminDb.from("posts_text").insert({
        post_id: firstPost!.id,
        post_subject: "First",
        post_text: "First post",
      });

      await adminDb
        .from("topics")
        .update({
          topic_first_post_id: firstPost!.id,
          topic_last_post_id: firstPost!.id,
        })
        .eq("id", topic!.id);

      // Add a reply to delete
      const { data: reply } = await adminDb
        .from("posts")
        .insert({
          topic_id: topic!.id,
          forum_id: testForumId,
          poster_id: testUserId,
        })
        .select()
        .single();

      await adminDb.from("posts_text").insert({
        post_id: reply!.id,
        post_subject: "Re: First",
        post_text: "Reply to delete",
      });

      // Delete the reply
      const formData = new FormData();
      formData.append("mode", "delete");
      formData.append("post_id", String(reply!.id));

      const res = await app.request("/posting", {
        method: "POST",
        body: formData,
        headers: authHeaders(),
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain(`/viewtopic/${topic!.id}`);

      // Verify post was deleted
      const { data: deletedPost } = await adminDb
        .from("posts")
        .select("id")
        .eq("id", reply!.id)
        .single();
      expect(deletedPost).toBeNull();
    });

    it("deletes entire topic when first post is deleted", async () => {
      const { data: topic } = await adminDb
        .from("topics")
        .insert({
          forum_id: testForumId,
          topic_title: "Topic To Delete Entirely",
          topic_poster: testUserId,
        })
        .select()
        .single();
      // Don't add to cleanup - it'll be deleted by the test

      const { data: post } = await adminDb
        .from("posts")
        .insert({
          topic_id: topic!.id,
          forum_id: testForumId,
          poster_id: testUserId,
        })
        .select()
        .single();

      await adminDb.from("posts_text").insert({
        post_id: post!.id,
        post_subject: "To Delete",
        post_text: "Delete me",
      });

      await adminDb
        .from("topics")
        .update({
          topic_first_post_id: post!.id,
          topic_last_post_id: post!.id,
        })
        .eq("id", topic!.id);

      const formData = new FormData();
      formData.append("mode", "delete");
      formData.append("post_id", String(post!.id));

      const res = await app.request("/posting", {
        method: "POST",
        body: formData,
        headers: authHeaders(),
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain(`/viewforum/${testForumId}`);

      // Verify topic was deleted
      const { data: deletedTopic } = await adminDb
        .from("topics")
        .select("id")
        .eq("id", topic!.id)
        .single();
      expect(deletedTopic).toBeNull();
    });
  });
});
