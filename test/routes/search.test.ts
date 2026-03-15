import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";

config({ path: ".env" });

let adminDb: SupabaseClient;
let testUserId: string;
let testForumId: number;
let testTopicId: number;
let testPostId: number;
let accessToken: string;
let refreshToken: string;

beforeAll(async () => {
  adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Cleanup
  const { data: existing } = await adminDb
    .from("profiles")
    .select("id")
    .eq("username", "SearchTester")
    .single();
  if (existing) {
    await adminDb.from("topics").delete().eq("topic_poster", existing.id);
    await adminDb.auth.admin.deleteUser(existing.id);
  }

  // Create user
  const { data: authData } = await adminDb.auth.admin.createUser({
    email: "searchtest@plank.local",
    password: "testpass123",
    email_confirm: true,
  });
  testUserId = authData.user!.id;
  await adminDb.from("profiles").insert({
    id: testUserId,
    username: "SearchTester",
  });

  // Get forum
  const { data: forum } = await adminDb
    .from("forums")
    .select("id")
    .limit(1)
    .single();
  testForumId = forum!.id;

  // Create a searchable topic + post
  const { data: topic } = await adminDb
    .from("topics")
    .insert({
      forum_id: testForumId,
      topic_title: "Searchable Quantum Topic",
      topic_poster: testUserId,
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
    post_subject: "Searchable Quantum Topic",
    post_text: "This is about quantum computing and entanglement",
  });

  await adminDb
    .from("topics")
    .update({
      topic_first_post_id: testPostId,
      topic_last_post_id: testPostId,
    })
    .eq("id", testTopicId);

  // Login
  const loginForm = new FormData();
  loginForm.append("username", "SearchTester");
  loginForm.append("password", "testpass123");
  const loginRes = await app.request("/login", {
    method: "POST",
    body: loginForm,
  });
  const cookies = loginRes.headers.getSetCookie();
  accessToken = cookies
    .find((c) => c.startsWith("sb-access-token="))!
    .substring("sb-access-token=".length)
    .split(";")[0];
  refreshToken = cookies
    .find((c) => c.startsWith("sb-refresh-token="))!
    .substring("sb-refresh-token=".length)
    .split(";")[0];
});

afterAll(async () => {
  await adminDb.from("topics").delete().eq("id", testTopicId);
  await adminDb.auth.admin.deleteUser(testUserId);
});

function authHeaders(): HeadersInit {
  return {
    Cookie: `sb-access-token=${accessToken}; sb-refresh-token=${refreshToken}`,
  };
}

describe("Search", () => {
  describe("search form", () => {
    it("renders the search form", async () => {
      const res = await app.request("/search");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Search Query");
      expect(html).toContain("Search for Keywords");
      expect(html).toContain("Search for Author");
    });
  });

  describe("keyword search", () => {
    it("finds topics by keyword (topic results)", async () => {
      const res = await app.request(
        "/search?search_keywords=quantum&show_results=topics"
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Searchable Quantum Topic");
      expect(html).toContain("Search found");
    });

    it("finds posts by keyword (post results)", async () => {
      const res = await app.request(
        "/search?search_keywords=entanglement&show_results=posts"
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("entanglement");
      expect(html).toContain("SearchTester");
    });

    it("returns empty results for non-matching search", async () => {
      const res = await app.request(
        "/search?search_keywords=xyznonexistent123"
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Search found 0");
    });
  });

  describe("author search", () => {
    it("finds posts by author", async () => {
      const res = await app.request(
        "/search?search_author=SearchTester&show_results=topics"
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Searchable Quantum Topic");
    });
  });

  describe("POST search form", () => {
    it("redirects to GET with params", async () => {
      const formData = new FormData();
      formData.append("search_keywords", "quantum");
      formData.append("show_results", "topics");

      const res = await app.request("/search", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(302);
      const location = res.headers.get("location")!;
      expect(location).toContain("search_keywords=quantum");
      expect(location).toContain("show_results=topics");
    });
  });

  describe("quick searches", () => {
    it("shows unanswered topics", async () => {
      const res = await app.request("/search?mode=unanswered");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("View unanswered posts");
    });

    it("shows ego search (own posts)", async () => {
      const res = await app.request("/search?mode=egosearch", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Search found");
    });

    it("shows new posts since last visit", async () => {
      const res = await app.request("/search?mode=newposts", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("View new posts");
    });
  });
});
