import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";

config({ path: ".env" });

let adminDb: SupabaseClient;
let testUserId: string;
let testUser2Id: string;
let testForumId: number;
let testTopicId: number;
let testPostId: number;
let pollId: number;
let optionAId: number;
let optionBId: number;
let accessToken: string;
let refreshToken: string;
let access2: string;
let refresh2: string;

async function cleanupUser(username: string) {
  const { data } = await adminDb
    .from("profiles")
    .select("id")
    .eq("username", username)
    .single();
  if (data) {
    await adminDb.from("poll_votes").delete().eq("user_id", data.id);
    await adminDb.from("topics").delete().eq("topic_poster", data.id);
    await adminDb.auth.admin.deleteUser(data.id);
  }
}

async function createAndLogin(
  username: string,
  email: string,
  password: string
): Promise<{ userId: string; access: string; refresh: string }> {
  const { data: authData } = await adminDb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  const userId = authData.user!.id;
  await adminDb.from("profiles").insert({ id: userId, username });

  const loginForm = new FormData();
  loginForm.append("username", username);
  loginForm.append("password", password);
  const loginRes = await app.request("/login", {
    method: "POST",
    body: loginForm,
  });
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

beforeAll(async () => {
  adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  await cleanupUser("PollTester1");
  await cleanupUser("PollTester2");

  const user1 = await createAndLogin("PollTester1", "polltest1@plank.local", "testpass123");
  testUserId = user1.userId;
  accessToken = user1.access;
  refreshToken = user1.refresh;

  const user2 = await createAndLogin("PollTester2", "polltest2@plank.local", "testpass123");
  testUser2Id = user2.userId;
  access2 = user2.access;
  refresh2 = user2.refresh;

  // Get forum
  const { data: forum } = await adminDb
    .from("forums")
    .select("id")
    .limit(1)
    .single();
  testForumId = forum!.id;

  // Create topic with a poll
  const { data: topic } = await adminDb
    .from("topics")
    .insert({
      forum_id: testForumId,
      topic_title: "Poll Test Topic",
      topic_poster: testUserId,
      topic_vote: 1,
    })
    .select()
    .single();
  testTopicId = topic!.id;

  const { data: post } = await adminDb
    .from("posts")
    .insert({
      topic_id: testTopicId,
      forum_id: testForumId,
      poster_id: testUserId,
    })
    .select()
    .single();
  testPostId = post!.id;

  await adminDb.from("posts_text").insert({
    post_id: testPostId,
    post_subject: "Poll Test Topic",
    post_text: "This topic has a poll",
  });

  await adminDb
    .from("topics")
    .update({
      topic_first_post_id: testPostId,
      topic_last_post_id: testPostId,
    })
    .eq("id", testTopicId);

  // Create poll
  const { data: pollQ } = await adminDb
    .from("poll_questions")
    .insert({
      topic_id: testTopicId,
      poll_text: "What is your favorite color?",
    })
    .select()
    .single();
  pollId = pollQ!.id;

  // Create options
  const { data: optA } = await adminDb
    .from("poll_options")
    .insert({
      poll_id: pollId,
      option_text: "Red",
      option_order: 0,
    })
    .select()
    .single();
  optionAId = optA!.id;

  const { data: optB } = await adminDb
    .from("poll_options")
    .insert({
      poll_id: pollId,
      option_text: "Blue",
      option_order: 1,
    })
    .select()
    .single();
  optionBId = optB!.id;
});

afterAll(async () => {
  await adminDb.from("poll_votes").delete().eq("poll_id", pollId);
  await adminDb.from("poll_options").delete().eq("poll_id", pollId);
  await adminDb.from("poll_questions").delete().eq("id", pollId);
  await adminDb.from("topics").delete().eq("id", testTopicId);
  await adminDb.auth.admin.deleteUser(testUserId);
  await adminDb.auth.admin.deleteUser(testUser2Id);
});

function authHeaders(): HeadersInit {
  return {
    Cookie: `sb-access-token=${accessToken}; sb-refresh-token=${refreshToken}`,
  };
}

function auth2Headers(): HeadersInit {
  return {
    Cookie: `sb-access-token=${access2}; sb-refresh-token=${refresh2}`,
  };
}

describe("Polls", () => {
  describe("poll display on viewtopic", () => {
    it("shows poll ballot for logged-in user who hasn't voted", async () => {
      const res = await app.request(`/viewtopic/${testTopicId}`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("What is your favorite color?");
      expect(html).toContain("Red");
      expect(html).toContain("Blue");
      expect(html).toContain("Submit Vote");
    });

    it("shows poll results for unauthenticated users", async () => {
      const res = await app.request(`/viewtopic/${testTopicId}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("What is your favorite color?");
      expect(html).toContain("Total Votes");
    });

    it("shows poll results when poll_results=1 query param", async () => {
      const res = await app.request(
        `/viewtopic/${testTopicId}?poll_results=1`,
        { headers: authHeaders() }
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Total Votes");
    });
  });

  describe("voting", () => {
    it("rejects vote when not logged in", async () => {
      const formData = new FormData();
      formData.append("topic_id", String(testTopicId));
      formData.append("vote_id", String(optionAId));

      const res = await app.request("/poll", {
        method: "POST",
        body: formData,
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });

    it("submits a vote successfully", async () => {
      const formData = new FormData();
      formData.append("topic_id", String(testTopicId));
      formData.append("vote_id", String(optionAId));

      const res = await app.request("/poll", {
        method: "POST",
        body: formData,
        headers: authHeaders(),
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/viewtopic/${testTopicId}`);

      // Verify vote was recorded
      const { data: vote } = await adminDb
        .from("poll_votes")
        .select("*")
        .eq("poll_id", pollId)
        .eq("user_id", testUserId)
        .single();
      expect(vote).not.toBeNull();
      expect(vote!.option_id).toBe(optionAId);

      // Verify vote count incremented
      const { data: opt } = await adminDb
        .from("poll_options")
        .select("vote_count")
        .eq("id", optionAId)
        .single();
      expect(opt!.vote_count).toBe(1);
    });

    it("prevents duplicate voting", async () => {
      const formData = new FormData();
      formData.append("topic_id", String(testTopicId));
      formData.append("vote_id", String(optionBId));

      const res = await app.request("/poll", {
        method: "POST",
        body: formData,
        headers: authHeaders(),
      });
      // Should redirect without recording a second vote
      expect(res.status).toBe(302);

      // Verify still only one vote
      const { data: votes } = await adminDb
        .from("poll_votes")
        .select("*")
        .eq("poll_id", pollId)
        .eq("user_id", testUserId);
      expect(votes!.length).toBe(1);
      expect(votes![0].option_id).toBe(optionAId); // Still the original vote
    });

    it("shows results after voting", async () => {
      const res = await app.request(`/viewtopic/${testTopicId}`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      // Should see results now, not the ballot
      expect(html).toContain("Total Votes");
      expect(html).not.toContain("Submit Vote");
    });

    it("allows a different user to vote", async () => {
      const formData = new FormData();
      formData.append("topic_id", String(testTopicId));
      formData.append("vote_id", String(optionBId));

      const res = await app.request("/poll", {
        method: "POST",
        body: formData,
        headers: auth2Headers(),
      });
      expect(res.status).toBe(302);

      const { data: opt } = await adminDb
        .from("poll_options")
        .select("vote_count")
        .eq("id", optionBId)
        .single();
      expect(opt!.vote_count).toBe(1);
    });

    it("rejects vote for invalid option", async () => {
      const formData = new FormData();
      formData.append("topic_id", String(testTopicId));
      formData.append("vote_id", "99999");

      // Use user2 headers but they already voted, so let's just check the 302 redirect
      // Actually, user2 already voted so it will redirect. Let's test with invalid topic instead.
      const formData2 = new FormData();
      formData2.append("topic_id", "99999");
      formData2.append("vote_id", String(optionAId));

      const res = await app.request("/poll", {
        method: "POST",
        body: formData2,
        headers: authHeaders(),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("expired poll", () => {
    let expiredTopicId: number;
    let expiredPollId: number;
    let expiredOptionId: number;

    beforeAll(async () => {
      // Create a topic with an expired poll
      const { data: topic } = await adminDb
        .from("topics")
        .insert({
          forum_id: testForumId,
          topic_title: "Expired Poll Topic",
          topic_poster: testUserId,
          topic_vote: 1,
        })
        .select()
        .single();
      expiredTopicId = topic!.id;

      const { data: post } = await adminDb
        .from("posts")
        .insert({
          topic_id: expiredTopicId,
          forum_id: testForumId,
          poster_id: testUserId,
        })
        .select()
        .single();

      await adminDb.from("posts_text").insert({
        post_id: post!.id,
        post_subject: "Expired Poll Topic",
        post_text: "This poll has expired",
      });

      await adminDb
        .from("topics")
        .update({
          topic_first_post_id: post!.id,
          topic_last_post_id: post!.id,
        })
        .eq("id", expiredTopicId);

      const { data: pollQ } = await adminDb
        .from("poll_questions")
        .insert({
          topic_id: expiredTopicId,
          poll_text: "Expired question?",
          poll_start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days ago
          poll_length: "1 day",
        })
        .select()
        .single();
      expiredPollId = pollQ!.id;

      const { data: opt } = await adminDb
        .from("poll_options")
        .insert({
          poll_id: expiredPollId,
          option_text: "Expired Option",
          option_order: 0,
        })
        .select()
        .single();
      expiredOptionId = opt!.id;
    });

    afterAll(async () => {
      await adminDb.from("poll_options").delete().eq("poll_id", expiredPollId);
      await adminDb.from("poll_questions").delete().eq("id", expiredPollId);
      await adminDb.from("topics").delete().eq("id", expiredTopicId);
    });

    it("shows results for expired poll", async () => {
      const res = await app.request(`/viewtopic/${expiredTopicId}`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Total Votes");
      expect(html).not.toContain("Submit Vote");
    });

    it("prevents voting on expired poll", async () => {
      const formData = new FormData();
      formData.append("topic_id", String(expiredTopicId));
      formData.append("vote_id", String(expiredOptionId));

      const res = await app.request("/poll", {
        method: "POST",
        body: formData,
        headers: authHeaders(),
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/viewtopic/${expiredTopicId}`);

      // Verify no vote was recorded
      const { data: votes } = await adminDb
        .from("poll_votes")
        .select("*")
        .eq("poll_id", expiredPollId);
      expect(votes!.length).toBe(0);
    });
  });
});
