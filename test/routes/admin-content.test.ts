import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";

config({ path: ".env" });

let adminDb: SupabaseClient;
let adminUserId: string;
let targetUserId: string;
let adminAccess: string;
let adminRefresh: string;

async function cleanupUser(username: string) {
  const { data } = await adminDb
    .from("profiles")
    .select("id")
    .eq("username", username)
    .single();
  if (data) {
    await adminDb.from("banlist").delete().eq("ban_userid", data.id);
    await adminDb.auth.admin.deleteUser(data.id);
  }
}

async function createAndLogin(
  username: string,
  email: string,
  password: string,
  userLevel: number = 0
): Promise<{ userId: string; access: string; refresh: string }> {
  const { data: authData } = await adminDb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
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

  await cleanupUser("ContentAdmin");
  await cleanupUser("ContentTarget");

  const adm = await createAndLogin("ContentAdmin", "contentadmin@plank.local", "testpass123", 1);
  adminUserId = adm.userId;
  adminAccess = adm.access;
  adminRefresh = adm.refresh;

  const target = await createAndLogin("ContentTarget", "contenttarget@plank.local", "testpass123", 0);
  targetUserId = target.userId;
});

afterAll(async () => {
  await adminDb.from("banlist").delete().eq("ban_userid", targetUserId);
  await adminDb.from("banlist").delete().eq("ban_email", "banned@test.com");
  await cleanupUser("ContentAdmin");
  await cleanupUser("ContentTarget");
});

function admHeaders(): HeadersInit {
  return {
    Cookie: `sb-access-token=${adminAccess}; sb-refresh-token=${adminRefresh}`,
  };
}

describe("Admin - Users & Content", () => {
  describe("user management", () => {
    it("renders user search form", async () => {
      const res = await app.request("/admin/users", { headers: admHeaders() });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("User Management");
    });

    it("finds and shows user edit form", async () => {
      const res = await app.request(
        "/admin/users?mode=edit&username=ContentTarget",
        { headers: admHeaders() }
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("ContentTarget");
      expect(html).toContain("User Level");
    });

    it("returns 404 for nonexistent user", async () => {
      const res = await app.request(
        "/admin/users?mode=edit&username=NonexistentUser99999",
        { headers: admHeaders() }
      );
      expect(res.status).toBe(404);
    });

    it("updates user profile", async () => {
      const formData = new FormData();
      formData.append("user_id", targetUserId);
      formData.append("mode", "save");
      formData.append("username", "ContentTarget");
      formData.append("user_level", "2"); // promote to mod
      formData.append("user_from", "Test City");
      formData.append("user_active", "1");

      const res = await app.request("/admin/users", {
        method: "POST",
        body: formData,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: profile } = await adminDb
        .from("profiles")
        .select("user_level, user_from")
        .eq("id", targetUserId)
        .single();
      expect(profile!.user_level).toBe(2);
      expect(profile!.user_from).toBe("Test City");

      // Revert
      await adminDb.from("profiles").update({ user_level: 0 }).eq("id", targetUserId);
    });
  });

  describe("ban management", () => {
    it("renders ban page", async () => {
      const res = await app.request("/admin/bans", { headers: admHeaders() });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Ban Management");
      expect(html).toContain("Ban User");
    });

    it("bans a user by username", async () => {
      const formData = new FormData();
      formData.append("username", "ContentTarget");

      const res = await app.request("/admin/bans", {
        method: "POST",
        body: formData,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: ban } = await adminDb
        .from("banlist")
        .select("*")
        .eq("ban_userid", targetUserId)
        .single();
      expect(ban).not.toBeNull();
    });

    it("unbans a user", async () => {
      // Get ban ID
      const { data: ban } = await adminDb
        .from("banlist")
        .select("id")
        .eq("ban_userid", targetUserId)
        .single();

      const formData = new FormData();
      formData.append("unban_userid", String(ban!.id));

      const res = await app.request("/admin/bans", {
        method: "POST",
        body: formData,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: remainingBan } = await adminDb
        .from("banlist")
        .select("id")
        .eq("ban_userid", targetUserId)
        .single();
      expect(remainingBan).toBeNull();
    });

    it("bans an email", async () => {
      const formData = new FormData();
      formData.append("ban_email", "banned@test.com");

      const res = await app.request("/admin/bans", {
        method: "POST",
        body: formData,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: ban } = await adminDb
        .from("banlist")
        .select("*")
        .eq("ban_email", "banned@test.com")
        .single();
      expect(ban).not.toBeNull();
    });
  });

  describe("rank management", () => {
    let testRankId: number;

    it("renders rank list", async () => {
      const res = await app.request("/admin/ranks", { headers: admHeaders() });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Rank Management");
    });

    it("creates a rank", async () => {
      const formData = new FormData();
      formData.append("add", "Add new rank");
      formData.append("rank_title", "Test Rank");
      formData.append("rank_min", "100");

      const res = await app.request("/admin/ranks", {
        method: "POST",
        body: formData,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: rank } = await adminDb
        .from("ranks")
        .select("*")
        .eq("rank_title", "Test Rank")
        .single();
      expect(rank).not.toBeNull();
      expect(rank!.rank_min).toBe(100);
      testRankId = rank!.id;
    });

    it("deletes a rank", async () => {
      const res = await app.request(
        `/admin/rank-action?mode=delete&id=${testRankId}`,
        { headers: admHeaders() }
      );
      expect(res.status).toBe(302);

      const { data: rank } = await adminDb
        .from("ranks")
        .select("id")
        .eq("id", testRankId)
        .single();
      expect(rank).toBeNull();
    });
  });

  describe("smiley management", () => {
    let testSmileyId: number;

    it("renders smiley list", async () => {
      const res = await app.request("/admin/smilies", { headers: admHeaders() });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Smiley Management");
    });

    it("creates a smiley", async () => {
      const formData = new FormData();
      formData.append("add", "Add new smiley");
      formData.append("code", ":testface:");
      formData.append("smile_url", "images/smilies/test.gif");
      formData.append("emoticon", "Test Face");

      const res = await app.request("/admin/smilies", {
        method: "POST",
        body: formData,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: smiley } = await adminDb
        .from("smilies")
        .select("*")
        .eq("code", ":testface:")
        .single();
      expect(smiley).not.toBeNull();
      testSmileyId = smiley!.id;
    });

    it("deletes a smiley", async () => {
      const res = await app.request(
        `/admin/smiley-action?mode=delete&id=${testSmileyId}`,
        { headers: admHeaders() }
      );
      expect(res.status).toBe(302);

      const { data: smiley } = await adminDb
        .from("smilies")
        .select("id")
        .eq("id", testSmileyId)
        .single();
      expect(smiley).toBeNull();
    });
  });

  describe("word censor management", () => {
    let testWordId: number;

    it("renders word list", async () => {
      const res = await app.request("/admin/words", { headers: admHeaders() });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Word Censor Management");
    });

    it("creates a word censor", async () => {
      const formData = new FormData();
      formData.append("add", "Add new word");
      formData.append("word", "testbadword");
      formData.append("replacement", "****");

      const res = await app.request("/admin/words", {
        method: "POST",
        body: formData,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: word } = await adminDb
        .from("word_censors")
        .select("*")
        .eq("word", "testbadword")
        .single();
      expect(word).not.toBeNull();
      expect(word!.replacement).toBe("****");
      testWordId = word!.id;
    });

    it("deletes a word censor", async () => {
      const res = await app.request(
        `/admin/word-action?mode=delete&id=${testWordId}`,
        { headers: admHeaders() }
      );
      expect(res.status).toBe(302);

      const { data: word } = await adminDb
        .from("word_censors")
        .select("id")
        .eq("id", testWordId)
        .single();
      expect(word).toBeNull();
    });
  });
});
