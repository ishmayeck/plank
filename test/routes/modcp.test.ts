import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";

config({ path: ".env" });

let adminDb: SupabaseClient;
let modUserId: string;
let normalUserId: string;
let modAccess: string;
let modRefresh: string;
let normalAccess: string;
let normalRefresh: string;
let testForumId: number;
let testForum2Id: number;
let testTopicId: number;
let testPostId: number;
let testPost2Id: number;

async function deleteUserAndAllRefs(userId: string) {
  // posts.poster_id and topics.topic_poster reference profiles(id)
  // without ON DELETE CASCADE — clean them out by hand.
  await adminDb.from("posts").delete().eq("poster_id", userId);
  await adminDb.from("topics").delete().eq("topic_poster", userId);
  await adminDb.from("privmsgs").delete().eq("privmsgs_from_userid", userId);
  await adminDb.from("privmsgs").delete().eq("privmsgs_to_userid", userId);
  await adminDb.auth.admin.deleteUser(userId);
}

async function cleanupUser(username: string, email?: string) {
  const { data } = await adminDb
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (data) await deleteUserAndAllRefs(data.id);
  // supabase db reset doesn't always truncate auth.users — also wipe by email
  if (email) {
    const { data: list } = await adminDb.auth.admin.listUsers({ perPage: 1000 });
    for (const u of list?.users ?? []) {
      if (u.email === email) await deleteUserAndAllRefs(u.id);
    }
  }
}

async function createAndLogin(
  username: string,
  email: string,
  password: string,
  userLevel: number = 0
): Promise<{ userId: string; access: string; refresh: string }> {
  const { data: authData, error: authErr } = await adminDb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authErr || !authData?.user) {
    throw new Error(`createUser(${email}) failed: ${authErr?.message ?? "no user"}`);
  }
  const userId = authData.user!.id;
  await adminDb.from("profiles").insert({ id: userId, username, user_level: userLevel });

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

  await cleanupUser("ModCPMod", "modcpmod@plank.local");
  await cleanupUser("ModCPNormal", "modcpnormal@plank.local");

  // Create mod user (user_level=2)
  const mod = await createAndLogin("ModCPMod", "modcpmod@plank.local", "testpass123", 2);
  modUserId = mod.userId;
  modAccess = mod.access;
  modRefresh = mod.refresh;

  // Create normal user
  const normal = await createAndLogin("ModCPNormal", "modcpnormal@plank.local", "testpass123", 0);
  normalUserId = normal.userId;
  normalAccess = normal.access;
  normalRefresh = normal.refresh;

  // Get two forums
  const { data: forums } = await adminDb
    .from("forums")
    .select("id")
    .order("id")
    .limit(2);
  testForumId = forums![0].id;
  testForum2Id = forums![1]?.id ?? forums![0].id;

  // Create topic with two posts
  const { data: topic } = await adminDb
    .from("topics")
    .insert({
      forum_id: testForumId,
      topic_title: "ModCP Test Topic",
      topic_poster: modUserId,
    })
    .select()
    .single();
  testTopicId = topic!.id;

  const { data: post1 } = await adminDb
    .from("posts")
    .insert({
      topic_id: testTopicId,
      forum_id: testForumId,
      poster_id: modUserId,
      poster_ip: "192.168.1.100",
    })
    .select()
    .single();
  testPostId = post1!.id;

  await adminDb.from("posts_text").insert({
    post_id: testPostId,
    post_subject: "ModCP Test Topic",
    post_text: "First post in mod test topic",
  });

  const { data: post2 } = await adminDb
    .from("posts")
    .insert({
      topic_id: testTopicId,
      forum_id: testForumId,
      poster_id: modUserId,
      poster_ip: "192.168.1.100",
    })
    .select()
    .single();
  testPost2Id = post2!.id;

  await adminDb.from("posts_text").insert({
    post_id: testPost2Id,
    post_subject: "Re: ModCP Test Topic",
    post_text: "Second post for split testing",
  });

  await adminDb
    .from("topics")
    .update({
      topic_first_post_id: testPostId,
      topic_last_post_id: testPost2Id,
      topic_replies: 1,
    })
    .eq("id", testTopicId);
});

afterAll(async () => {
  // Cleanup any leftover topics
  await adminDb.from("topics").delete().eq("topic_poster", modUserId);
  await adminDb.from("topics").delete().eq("topic_poster", normalUserId);
  await adminDb.auth.admin.deleteUser(modUserId);
  await adminDb.auth.admin.deleteUser(normalUserId);
});

function modHeaders(): HeadersInit {
  return {
    Cookie: `sb-access-token=${modAccess}; sb-refresh-token=${modRefresh}`,
  };
}

function normalHeaders(): HeadersInit {
  return {
    Cookie: `sb-access-token=${normalAccess}; sb-refresh-token=${normalRefresh}`,
  };
}

describe("Moderation Control Panel", () => {
  describe("access control", () => {
    it("returns 403 for normal users on modcp", async () => {
      const res = await app.request(`/modcp?f=${testForumId}`, {
        headers: normalHeaders(),
      });
      expect(res.status).toBe(403);
    });

    it("returns 403 for unauthenticated users", async () => {
      const res = await app.request(`/modcp?f=${testForumId}`);
      expect(res.status).toBe(403);
    });

    it("allows mod users to access modcp", async () => {
      const res = await app.request(`/modcp?f=${testForumId}`, {
        headers: modHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Moderator Control Panel");
      expect(html).toContain("ModCP Test Topic");
    });
  });

  describe("lock/unlock topics", () => {
    let lockTopicId: number;

    beforeAll(async () => {
      const { data: t } = await adminDb
        .from("topics")
        .insert({
          forum_id: testForumId,
          topic_title: "Lock Me Topic",
          topic_poster: modUserId,
        })
        .select()
        .single();
      lockTopicId = t!.id;
    });

    it("locks a topic", async () => {
      const formData = new FormData();
      formData.append("f", String(testForumId));
      formData.append("topic_id_list[]", String(lockTopicId));
      formData.append("lock", "Lock");

      const res = await app.request("/modcp", {
        method: "POST",
        body: formData,
        headers: modHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("The selected topics have been locked.");

      const { data: topic } = await adminDb
        .from("topics")
        .select("topic_status")
        .eq("id", lockTopicId)
        .single();
      expect(topic!.topic_status).toBe(1);
    });

    it("unlocks a topic", async () => {
      const formData = new FormData();
      formData.append("f", String(testForumId));
      formData.append("topic_id_list[]", String(lockTopicId));
      formData.append("unlock", "Unlock");

      const res = await app.request("/modcp", {
        method: "POST",
        body: formData,
        headers: modHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("The selected topics have been unlocked.");

      const { data: topic } = await adminDb
        .from("topics")
        .select("topic_status")
        .eq("id", lockTopicId)
        .single();
      expect(topic!.topic_status).toBe(0);
    });
  });

  describe("delete topics", () => {
    let deleteTopicId: number;

    beforeAll(async () => {
      const { data: t } = await adminDb
        .from("topics")
        .insert({
          forum_id: testForumId,
          topic_title: "Delete Me Topic",
          topic_poster: modUserId,
        })
        .select()
        .single();
      deleteTopicId = t!.id;
    });

    it("deletes a topic", async () => {
      const formData = new FormData();
      formData.append("f", String(testForumId));
      formData.append("topic_id_list[]", String(deleteTopicId));
      formData.append("delete", "Delete");

      const res = await app.request("/modcp", {
        method: "POST",
        body: formData,
        headers: modHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("The selected topics have been successfully removed");

      const { data: topic } = await adminDb
        .from("topics")
        .select("id")
        .eq("id", deleteTopicId)
        .single();
      expect(topic).toBeNull();
    });
  });

  describe("move topics", () => {
    let moveTopicId: number;

    beforeAll(async () => {
      const { data: t } = await adminDb
        .from("topics")
        .insert({
          forum_id: testForumId,
          topic_title: "Move Me Topic",
          topic_poster: modUserId,
        })
        .select()
        .single();
      moveTopicId = t!.id;

      const { data: p } = await adminDb
        .from("posts")
        .insert({
          topic_id: moveTopicId,
          forum_id: testForumId,
          poster_id: modUserId,
        })
        .select()
        .single();

      await adminDb.from("posts_text").insert({
        post_id: p!.id,
        post_subject: "Move Me Topic",
        post_text: "Moving this topic",
      });
    });

    it("shows move confirmation page", async () => {
      const formData = new FormData();
      formData.append("f", String(testForumId));
      formData.append("topic_id_list[]", String(moveTopicId));
      formData.append("move", "Move");

      const res = await app.request("/modcp", {
        method: "POST",
        body: formData,
        headers: modHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Move Topic");
      expect(html).toContain("Leave shadow topic");
    });

    it("moves a topic to another forum", async () => {
      if (testForumId === testForum2Id) return; // skip if only one forum

      const formData = new FormData();
      formData.append("f", String(testForumId));
      formData.append("topic_id_list[]", String(moveTopicId));
      formData.append("mode", "move");
      formData.append("new_forum_id", String(testForum2Id));
      formData.append("confirm", "Yes");

      const res = await app.request("/modcp", {
        method: "POST",
        body: formData,
        headers: modHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("The selected topics have been moved.");

      const { data: topic } = await adminDb
        .from("topics")
        .select("forum_id")
        .eq("id", moveTopicId)
        .single();
      expect(topic!.forum_id).toBe(testForum2Id);
    });
  });

  describe("split topic", () => {
    it("renders split page", async () => {
      const res = await app.request(`/modcp/split?t=${testTopicId}`, {
        headers: modHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Split Topic");
      expect(html).toContain("First post in mod test topic");
      expect(html).toContain("Second post for split testing");
    });

    it("splits selected posts into new topic", async () => {
      const formData = new FormData();
      formData.append("topic_id", String(testTopicId));
      formData.append("new_forum_id", String(testForumId));
      formData.append("subject", "Split Off Topic");
      formData.append("post_id_list[]", String(testPost2Id));
      formData.append("split_type_all", "Split selected posts");

      const res = await app.request("/modcp", {
        method: "POST",
        body: formData,
        headers: modHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("The selected topic has been split successfully.");

      // Verify original topic still has first post
      const { data: origPosts } = await adminDb
        .from("posts")
        .select("id")
        .eq("topic_id", testTopicId);
      expect(origPosts!.length).toBe(1);
      expect(origPosts![0].id).toBe(testPostId);

      // Verify new topic was created (find by title)
      const { data: newTopic } = await adminDb
        .from("topics")
        .select("id, topic_title")
        .eq("topic_title", "Split Off Topic")
        .single();
      expect(newTopic!.topic_title).toBe("Split Off Topic");
      const newTopicId = newTopic!.id;

      // Cleanup: move the post back
      await adminDb
        .from("posts")
        .update({ topic_id: testTopicId, forum_id: testForumId })
        .eq("id", testPost2Id);
      await adminDb.from("topics").delete().eq("id", newTopicId);
    });
  });

  describe("view IP", () => {
    it("returns 403 for normal users", async () => {
      const res = await app.request(`/modcp/ip?p=${testPostId}`, {
        headers: normalHeaders(),
      });
      expect(res.status).toBe(403);
    });

    it("shows IP information for a post", async () => {
      const res = await app.request(`/modcp/ip?p=${testPostId}`, {
        headers: modHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("IP Information");
      expect(html).toContain("192.168.1.100");
    });

    it("returns 404 for nonexistent post", async () => {
      const res = await app.request("/modcp/ip?p=99999", {
        headers: modHeaders(),
      });
      expect(res.status).toBe(404);
    });
  });
});
