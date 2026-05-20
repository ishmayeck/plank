import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";
import { cleanupTestUser } from "../util/users.js";

config({ path: ".env" });

let adminDb: SupabaseClient;
let adminUserId: string;
let normalUserId: string;
let modUserId: string;
let adminAccess: string;
let adminRefresh: string;
let normalAccess: string;
let normalRefresh: string;
let modAccess: string;
let modRefresh: string;

const cleanupUser = (username: string, email?: string) =>
  cleanupTestUser(adminDb, username, email);

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

  await cleanupUser("AdminTestAdmin", "admintestadmin@plank.local");
  await cleanupUser("AdminTestNormal", "admintestnormal@plank.local");
  await cleanupUser("AdminTestMod", "admintestmod@plank.local");

  const adm = await createAndLogin("AdminTestAdmin", "admintestadmin@plank.local", "testpass123", 1);
  adminUserId = adm.userId;
  adminAccess = adm.access;
  adminRefresh = adm.refresh;

  const norm = await createAndLogin("AdminTestNormal", "admintestnormal@plank.local", "testpass123", 0);
  normalUserId = norm.userId;
  normalAccess = norm.access;
  normalRefresh = norm.refresh;

  const mod = await createAndLogin("AdminTestMod", "admintestmod@plank.local", "testpass123", 2);
  modUserId = mod.userId;
  modAccess = mod.access;
  modRefresh = mod.refresh;
});

afterAll(async () => {
  // Restore original config values
  await adminDb.from("config").upsert({ config_name: "sitename", config_value: "Plank Forum" });
  await adminDb.from("config").delete().eq("config_name", "posts_per_page");
  await adminDb.auth.admin.deleteUser(adminUserId);
  await adminDb.auth.admin.deleteUser(normalUserId);
  await adminDb.auth.admin.deleteUser(modUserId);
});

function admHeaders(): HeadersInit {
  return {
    Cookie: `sb-access-token=${adminAccess}; sb-refresh-token=${adminRefresh}`,
  };
}

function normalHeaders(): HeadersInit {
  return {
    Cookie: `sb-access-token=${normalAccess}; sb-refresh-token=${normalRefresh}`,
  };
}

function modHeaders(): HeadersInit {
  return {
    Cookie: `sb-access-token=${modAccess}; sb-refresh-token=${modRefresh}`,
  };
}

describe("Admin Panel", () => {
  describe("access control", () => {
    it("returns 403 for non-admin on admin index", async () => {
      const res = await app.request("/admin", { headers: normalHeaders() });
      expect(res.status).toBe(403);
    });

    it("returns 403 for moderator on admin index", async () => {
      const res = await app.request("/admin", { headers: modHeaders() });
      expect(res.status).toBe(403);
    });

    it("returns 403 for unauthenticated on admin index", async () => {
      const res = await app.request("/admin");
      expect(res.status).toBe(403);
    });

    it("returns 403 for non-admin on config", async () => {
      const res = await app.request("/admin/config", { headers: normalHeaders() });
      expect(res.status).toBe(403);
    });

    it("returns 403 for non-admin on forums", async () => {
      const res = await app.request("/admin/forums", { headers: normalHeaders() });
      expect(res.status).toBe(403);
    });
  });

  describe("admin link visibility", () => {
    it("renders the admin link in the footer for admins", async () => {
      const res = await app.request("/", { headers: admHeaders() });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Go to Administration Panel");
    });

    it("does NOT render the admin link for moderators", async () => {
      const res = await app.request("/", { headers: modHeaders() });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).not.toContain("Go to Administration Panel");
    });

    it("does NOT render the admin link for regular users", async () => {
      const res = await app.request("/", { headers: normalHeaders() });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).not.toContain("Go to Administration Panel");
    });
  });

  describe("admin dashboard", () => {
    it("renders admin index with stats", async () => {
      const res = await app.request("/admin", { headers: admHeaders() });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Welcome to the Admin Panel");
      expect(html).toContain("Forum Statistics");
      expect(html).toContain("Number of posts");
    });
  });

  describe("admin layout shell", () => {
    it("renders the Plank sidebar with all four sections", async () => {
      const res = await app.request("/admin", { headers: admHeaders() });
      const html = await res.text();
      expect(html).toContain("plank-admin-sidebar");
      expect(html).toContain("Plank Admin");
      // Section headings
      expect(html).toContain(">Overview<");
      expect(html).toContain(">Forums<");
      expect(html).toContain(">Users<");
      expect(html).toContain(">Customization<");
      // Representative links from each section
      expect(html).toContain(`href="/admin"`);
      expect(html).toContain(`href="/admin/forums"`);
      expect(html).toContain(`href="/admin/auth"`);
      expect(html).toContain(`href="/admin/users"`);
      expect(html).toContain(`href="/admin/bans"`);
      expect(html).toContain(`href="/admin/config"`);
      expect(html).toContain(`href="/admin/ranks"`);
      expect(html).toContain(`href="/admin/smilies"`);
      expect(html).toContain(`href="/admin/words"`);
      // Return-to-forum link in the sidebar footer
      expect(html).toContain("Return to forum");
    });

    it("highlights the active sidebar item by exact path", async () => {
      const res = await app.request("/admin/config", { headers: admHeaders() });
      const html = await res.text();
      // The /admin/config item should be flagged active; /admin should not.
      expect(html).toMatch(
        /plank-admin-nav-item plank-admin-nav-item-active"><a href="\/admin\/config"/
      );
      expect(html).not.toMatch(
        /plank-admin-nav-item plank-admin-nav-item-active"><a href="\/admin"/
      );
    });

    it("highlights Permissions for /admin/auth/forum/:id (prefix match)", async () => {
      // Pick any forum to navigate into.
      const { data: forum } = await adminDb
        .from("forums")
        .select("id")
        .limit(1)
        .single();
      const res = await app.request(`/admin/auth/forum/${forum!.id}`, {
        headers: admHeaders(),
      });
      const html = await res.text();
      // /admin/auth* should light up its sidebar entry.
      expect(html).toMatch(
        /plank-admin-nav-item plank-admin-nav-item-active"><a href="\/admin\/auth"/
      );
    });

    it("references the theme stylesheet by an absolute path", async () => {
      // The original page_header.tpl used `../templates/Solaris/...` —
      // that path broke for any URL deeper than /admin/foo. Our shell
      // uses an absolute href, so this regresses if anyone reintroduces
      // the relative form.
      const res = await app.request("/admin/auth", { headers: admHeaders() });
      const html = await res.text();
      expect(html).toContain('href="/templates/Solaris/admin/subSilver.css"');
      expect(html).not.toContain('href="../templates');
    });
  });

  describe("board configuration", () => {
    it("renders config page", async () => {
      const res = await app.request("/admin/config", { headers: admHeaders() });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Board Configuration");
      expect(html).toContain("Site name");
      expect(html).toContain("Posts per page");
    });

    it("saves config values", async () => {
      const formData = new FormData();
      formData.append("sitename", "Test Forum Name");
      formData.append("posts_per_page", "20");

      const res = await app.request("/admin/config", {
        method: "POST",
        body: formData,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      // Verify saved
      const { data: siteConfig } = await adminDb
        .from("config")
        .select("config_value")
        .eq("config_name", "sitename")
        .single();
      expect(siteConfig!.config_value).toBe("Test Forum Name");

      const { data: postsConfig } = await adminDb
        .from("config")
        .select("config_value")
        .eq("config_name", "posts_per_page")
        .single();
      expect(postsConfig!.config_value).toBe("20");

      // Cleanup
      await adminDb.from("config").delete().eq("config_name", "posts_per_page");
    });
  });

  describe("forum management", () => {
    let testCatId: number;
    let testForumId: number;

    it("renders forum admin page", async () => {
      const res = await app.request("/admin/forums", { headers: admHeaders() });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Forum Administration");
      expect(html).toContain("Create new category");
    });

    it("creates a category", async () => {
      const formData = new FormData();
      formData.append("categoryname", "Admin Test Category");
      formData.append("addcategory", "Create new category");

      const res = await app.request("/admin/forums", {
        method: "POST",
        body: formData,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: cat } = await adminDb
        .from("categories")
        .select("id, cat_title")
        .eq("cat_title", "Admin Test Category")
        .single();
      expect(cat).not.toBeNull();
      testCatId = cat!.id;
    });

    it("creates a forum in the category", async () => {
      const formData = new FormData();
      formData.append(`forumname_${testCatId}`, "Admin Test Forum");
      formData.append(`addforum_${testCatId}`, "Create new forum");

      const res = await app.request("/admin/forums", {
        method: "POST",
        body: formData,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: forum } = await adminDb
        .from("forums")
        .select("id, forum_name, cat_id")
        .eq("forum_name", "Admin Test Forum")
        .single();
      expect(forum).not.toBeNull();
      expect(forum!.cat_id).toBe(testCatId);
      testForumId = forum!.id;
    });

    it("edits a forum", async () => {
      const formData = new FormData();
      formData.append("forum_id", String(testForumId));
      formData.append("forum_name", "Renamed Forum");
      formData.append("forum_desc", "New description");

      const res = await app.request("/admin/editforum", {
        method: "POST",
        body: formData,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: forum } = await adminDb
        .from("forums")
        .select("forum_name, forum_desc")
        .eq("id", testForumId)
        .single();
      expect(forum!.forum_name).toBe("Renamed Forum");
      expect(forum!.forum_desc).toBe("New description");
    });

    it("edits a category", async () => {
      const formData = new FormData();
      formData.append("cat_id", String(testCatId));
      formData.append("cat_title", "Renamed Category");

      const res = await app.request("/admin/editcat", {
        method: "POST",
        body: formData,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: cat } = await adminDb
        .from("categories")
        .select("cat_title")
        .eq("id", testCatId)
        .single();
      expect(cat!.cat_title).toBe("Renamed Category");
    });

    it("deletes a forum via action endpoint", async () => {
      const res = await app.request(
        `/admin/forum-action?mode=deleteforum&f=${testForumId}`,
        { headers: admHeaders() }
      );
      expect(res.status).toBe(302);

      const { data: forum } = await adminDb
        .from("forums")
        .select("id")
        .eq("id", testForumId)
        .single();
      expect(forum).toBeNull();
    });

    it("deletes a category via action endpoint", async () => {
      const res = await app.request(
        `/admin/forum-action?mode=deletecat&c=${testCatId}`,
        { headers: admHeaders() }
      );
      expect(res.status).toBe(302);

      const { data: cat } = await adminDb
        .from("categories")
        .select("id")
        .eq("id", testCatId)
        .single();
      expect(cat).toBeNull();
    });

    it("resyncs forum stats", async () => {
      // Get first forum
      const { data: forum } = await adminDb
        .from("forums")
        .select("id")
        .limit(1)
        .single();

      if (forum) {
        const res = await app.request(
          `/admin/forum-action?mode=resync&f=${forum.id}`,
          { headers: admHeaders() }
        );
        expect(res.status).toBe(302);
      }
    });
  });

  describe("permission management", () => {
    let testForumId: number;
    let testGroupId: number;
    let testCatId: number;

    beforeAll(async () => {
      const { data: cat } = await adminDb
        .from("categories")
        .insert({ cat_title: "PermAdmin Test Cat", cat_order: 9998 })
        .select()
        .single();
      testCatId = cat!.id;

      const { data: forum } = await adminDb
        .from("forums")
        .insert({ cat_id: testCatId, forum_name: "PermAdmin Test Forum", forum_order: 9998 })
        .select()
        .single();
      testForumId = forum!.id;

      const { data: group } = await adminDb
        .from("groups")
        .insert({ group_name: "PermAdmin Test Group", group_type: 1, group_description: "" })
        .select()
        .single();
      testGroupId = group!.id;
    });

    afterAll(async () => {
      await adminDb.from("forums").delete().eq("id", testForumId);
      await adminDb.from("groups").delete().eq("id", testGroupId);
      await adminDb.from("categories").delete().eq("id", testCatId);
    });

    it("returns 403 for non-admin on /admin/auth", async () => {
      const res = await app.request("/admin/auth", { headers: normalHeaders() });
      expect(res.status).toBe(403);
    });

    it("renders the auth landing page for admins", async () => {
      const res = await app.request("/admin/auth", { headers: admHeaders() });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Permission Management");
      expect(html).toContain("PermAdmin Test Forum");
      expect(html).toContain("PermAdmin Test Group");
    });

    it("renders the per-forum auth edit page", async () => {
      const res = await app.request(`/admin/auth/forum/${testForumId}`, {
        headers: admHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("PermAdmin Test Forum");
      // Should have selects for each action.
      expect(html).toContain(`name="auth_view"`);
      expect(html).toContain(`name="auth_post"`);
      expect(html).toContain(`name="auth_sticky"`);
    });

    it("saves per-forum auth levels", async () => {
      const form = new FormData();
      // Set the forum to require ACL for posting (level 2) and MOD
      // for sticky (level 3); keep view/read at defaults.
      form.append("auth_view", "0");
      form.append("auth_read", "0");
      form.append("auth_post", "2");
      form.append("auth_reply", "1");
      form.append("auth_edit", "1");
      form.append("auth_delete", "1");
      form.append("auth_sticky", "3");
      form.append("auth_announce", "3");
      form.append("auth_vote", "1");
      form.append("auth_pollcreate", "1");

      const res = await app.request(`/admin/auth/forum/${testForumId}`, {
        method: "POST",
        body: form,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: forum } = await adminDb
        .from("forums")
        .select("auth_post, auth_sticky")
        .eq("id", testForumId)
        .single();
      expect(forum!.auth_post).toBe(2);
      expect(forum!.auth_sticky).toBe(3);
    });

    it("clamps tampered auth levels to known values", async () => {
      const form = new FormData();
      // 99 isn't a valid level — should be ignored (not written).
      form.append("auth_post", "99");
      const res = await app.request(`/admin/auth/forum/${testForumId}`, {
        method: "POST",
        body: form,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: forum } = await adminDb
        .from("forums")
        .select("auth_post")
        .eq("id", testForumId)
        .single();
      // Previous value (2) preserved; 99 was rejected.
      expect(forum!.auth_post).toBe(2);
    });

    it("renders the per-group auth matrix page", async () => {
      const res = await app.request(`/admin/auth/group/${testGroupId}`, {
        headers: admHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("PermAdmin Test Group");
      expect(html).toContain("PermAdmin Test Forum");
      // Should have checkboxes for the per-forum bits.
      expect(html).toContain(`name="auth_view_${testForumId}"`);
      expect(html).toContain(`name="mod_${testForumId}"`);
    });

    it("saves group auth_access bits", async () => {
      const form = new FormData();
      form.append(`auth_view_${testForumId}`, "1");
      form.append(`auth_read_${testForumId}`, "1");
      form.append(`mod_${testForumId}`, "1");

      const res = await app.request(`/admin/auth/group/${testGroupId}`, {
        method: "POST",
        body: form,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: access } = await adminDb
        .from("auth_access")
        .select("*")
        .eq("group_id", testGroupId)
        .eq("forum_id", testForumId)
        .single();
      expect(access!.auth_view).toBe(true);
      expect(access!.auth_read).toBe(true);
      expect(access!.auth_post).toBe(false);
      expect(access!.auth_mod).toBe(true);
    });

    it("clears the auth_access row when no bits are checked", async () => {
      const form = new FormData();
      // No bits checked → row should be removed.
      const res = await app.request(`/admin/auth/group/${testGroupId}`, {
        method: "POST",
        body: form,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: access } = await adminDb
        .from("auth_access")
        .select("*")
        .eq("group_id", testGroupId)
        .eq("forum_id", testForumId)
        .maybeSingle();
      expect(access).toBeNull();
    });

    it("returns 403 for non-admin on the per-forum page", async () => {
      const res = await app.request(`/admin/auth/forum/${testForumId}`, {
        headers: normalHeaders(),
      });
      expect(res.status).toBe(403);
    });

    it("returns 403 for non-admin on the per-group page", async () => {
      const res = await app.request(`/admin/auth/group/${testGroupId}`, {
        headers: normalHeaders(),
      });
      expect(res.status).toBe(403);
    });
  });
});
