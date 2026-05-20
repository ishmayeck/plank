import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";
import { cleanupTestUser } from "../util/users.js";

config({ path: ".env" });

let adminDb: SupabaseClient;
let adminUserId: string;
let normalUserId: string;
let memberUserId: string;
let pendingUserId: string;
let adminAccess: string;
let adminRefresh: string;
let normalAccess: string;
let normalRefresh: string;

// Groups created during the suite. Stored so afterAll cleans them
// even if a test fails partway.
const createdGroupIds: number[] = [];

async function createAndLogin(
  username: string,
  email: string,
  password: string,
  userLevel: number = 0
): Promise<{ userId: string; access: string; refresh: string }> {
  await cleanupTestUser(adminDb, username, email);
  const { data: authData, error } = await adminDb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !authData?.user) {
    throw new Error(`createUser(${email}) failed: ${error?.message ?? "no user"}`);
  }
  const userId = authData.user.id;
  await adminDb.from("profiles").insert({ id: userId, username, user_level: userLevel });

  const loginForm = new FormData();
  loginForm.append("username", username);
  loginForm.append("password", password);
  const loginRes = await app.request("/login", { method: "POST", body: loginForm });
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

  const adm = await createAndLogin("GroupsAdminTester", "groups-admin@plank.local", "p1", 1);
  adminUserId = adm.userId;
  adminAccess = adm.access;
  adminRefresh = adm.refresh;

  const norm = await createAndLogin("GroupsNormalTester", "groups-norm@plank.local", "p1", 0);
  normalUserId = norm.userId;
  normalAccess = norm.access;
  normalRefresh = norm.refresh;

  const mem = await createAndLogin("GroupsMemberA", "groups-mem@plank.local", "p1", 0);
  memberUserId = mem.userId;

  const pend = await createAndLogin("GroupsPendingB", "groups-pend@plank.local", "p1", 0);
  pendingUserId = pend.userId;
});

afterAll(async () => {
  for (const gid of createdGroupIds) {
    await adminDb.from("groups").delete().eq("id", gid);
  }
  for (const id of [adminUserId, normalUserId, memberUserId, pendingUserId]) {
    await adminDb.auth.admin.deleteUser(id).catch(() => {});
  }
});

function admHeaders(): HeadersInit {
  return { Cookie: `sb-access-token=${adminAccess}; sb-refresh-token=${adminRefresh}` };
}
function normalHeaders(): HeadersInit {
  return { Cookie: `sb-access-token=${normalAccess}; sb-refresh-token=${normalRefresh}` };
}

describe("Admin - Groups", () => {
  describe("access control", () => {
    it("returns 403 for non-admin on /admin/groups", async () => {
      const res = await app.request("/admin/groups", { headers: normalHeaders() });
      expect(res.status).toBe(403);
    });
    it("returns 403 for unauthenticated on /admin/groups", async () => {
      const res = await app.request("/admin/groups");
      expect(res.status).toBe(403);
    });
    it("returns 403 for non-admin on /admin/groups/new", async () => {
      const res = await app.request("/admin/groups/new", { headers: normalHeaders() });
      expect(res.status).toBe(403);
    });
  });

  describe("list page", () => {
    it("renders the groups list with create link", async () => {
      const res = await app.request("/admin/groups", { headers: admHeaders() });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Group Management");
      expect(html).toContain("Create new group");
      // Sidebar should highlight the Groups entry on this URL.
      expect(html).toMatch(
        /plank-admin-nav-item plank-admin-nav-item-active"><a href="\/admin\/groups"/
      );
    });

    it("omits single-user groups from the list", async () => {
      // Insert a single-user group directly; should not appear in the listing.
      const { data: group } = await adminDb
        .from("groups")
        .insert({
          group_name: "GroupsSingleUserHidden",
          group_type: 1,
          group_description: "",
          group_single_user: true,
        })
        .select()
        .single();
      createdGroupIds.push(group!.id);

      const res = await app.request("/admin/groups", { headers: admHeaders() });
      const html = await res.text();
      expect(html).not.toContain("GroupsSingleUserHidden");
    });
  });

  describe("create + edit + delete", () => {
    let createdGroupId: number;

    it("creates a new group", async () => {
      const form = new FormData();
      form.append("group_name", "GroupsCRUDTest");
      form.append("group_description", "Created via test");
      form.append("group_type", "1"); // closed
      form.append("username", "GroupsAdminTester"); // moderator
      const res = await app.request("/admin/groups/new", {
        method: "POST",
        body: form,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);
      // Should redirect to the edit page for the newly-created group.
      const loc = res.headers.get("location") ?? "";
      expect(loc).toMatch(/^\/admin\/groups\/\d+\/edit$/);
      createdGroupId = parseInt(loc.split("/")[3], 10);
      createdGroupIds.push(createdGroupId);

      const { data: group } = await adminDb
        .from("groups")
        .select("*")
        .eq("id", createdGroupId)
        .single();
      expect(group!.group_name).toBe("GroupsCRUDTest");
      expect(group!.group_type).toBe(1);
      expect(group!.group_moderator).toBe(adminUserId);
      expect(group!.group_single_user).toBe(false);
    });

    it("renders the edit form with current values", async () => {
      const res = await app.request(`/admin/groups/${createdGroupId}/edit`, {
        headers: admHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("GroupsCRUDTest");
      expect(html).toContain("Created via test");
      expect(html).toContain("GroupsAdminTester");
      // "Closed" radio should be checked (group_type=1).
      expect(html).toMatch(/value="1"\s+checked\s/);
    });

    it("rejects a moderator username that doesn't exist", async () => {
      const form = new FormData();
      form.append("group_name", "GroupsCRUDTest");
      form.append("group_description", "");
      form.append("group_type", "1");
      form.append("username", "GroupsNoSuchUserXYZ");
      const res = await app.request(`/admin/groups/${createdGroupId}/edit`, {
        method: "POST",
        body: form,
        headers: admHeaders(),
      });
      expect(res.status).toBe(400);
    });

    it("updates name, description, type, and clears moderator", async () => {
      const form = new FormData();
      form.append("group_name", "GroupsCRUDRenamed");
      form.append("group_description", "Edited");
      form.append("group_type", "0"); // open
      form.append("delete_old_moderator", "1");
      const res = await app.request(`/admin/groups/${createdGroupId}/edit`, {
        method: "POST",
        body: form,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: group } = await adminDb
        .from("groups")
        .select("*")
        .eq("id", createdGroupId)
        .single();
      expect(group!.group_name).toBe("GroupsCRUDRenamed");
      expect(group!.group_description).toBe("Edited");
      expect(group!.group_type).toBe(0);
      expect(group!.group_moderator).toBeNull();
    });

    it("cascades user_group + auth_access on delete", async () => {
      // Seed a membership and an auth_access row so we can verify
      // the FK cascades fired.
      await adminDb.from("user_group").insert({
        group_id: createdGroupId,
        user_id: memberUserId,
        user_pending: false,
      });
      const { data: forum } = await adminDb
        .from("forums")
        .select("id")
        .limit(1)
        .single();
      await adminDb.from("auth_access").insert({
        group_id: createdGroupId,
        forum_id: forum!.id,
        auth_view: true,
      });

      const form = new FormData();
      form.append("group_delete", "1");
      // group_name is still required by the handler, but the delete
      // path short-circuits before that check.
      form.append("group_name", "GroupsCRUDRenamed");
      form.append("group_type", "0");
      const res = await app.request(`/admin/groups/${createdGroupId}/edit`, {
        method: "POST",
        body: form,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/admin/groups");

      const { data: group } = await adminDb
        .from("groups")
        .select("id")
        .eq("id", createdGroupId)
        .maybeSingle();
      expect(group).toBeNull();

      const { data: ug } = await adminDb
        .from("user_group")
        .select("*")
        .eq("group_id", createdGroupId);
      expect(ug).toEqual([]);

      const { data: aa } = await adminDb
        .from("auth_access")
        .select("*")
        .eq("group_id", createdGroupId);
      expect(aa).toEqual([]);
    });

    it("returns 404 on edit for nonexistent group", async () => {
      const res = await app.request("/admin/groups/99999999/edit", { headers: admHeaders() });
      expect(res.status).toBe(404);
    });
  });

  describe("members management", () => {
    let groupId: number;

    beforeAll(async () => {
      const { data: group } = await adminDb
        .from("groups")
        .insert({
          group_name: "GroupsMemberMgmtTest",
          group_type: 1,
          group_description: "",
        })
        .select()
        .single();
      groupId = group!.id;
      createdGroupIds.push(groupId);

      // Seed: one active member, one pending.
      await adminDb.from("user_group").insert([
        { group_id: groupId, user_id: memberUserId, user_pending: false },
        { group_id: groupId, user_id: pendingUserId, user_pending: true },
      ]);
    });

    it("renders active + pending members", async () => {
      const res = await app.request(`/admin/groups/${groupId}/members`, {
        headers: admHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("GroupsMemberA");
      expect(html).toContain("GroupsPendingB");
      expect(html).toContain("Active members");
      expect(html).toContain("Pending requests");
    });

    it("adds a member by username (skips approval)", async () => {
      const form = new FormData();
      form.append("action", "add");
      form.append("username", "GroupsNormalTester");
      const res = await app.request(`/admin/groups/${groupId}/members`, {
        method: "POST",
        body: form,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: row } = await adminDb
        .from("user_group")
        .select("user_pending")
        .eq("group_id", groupId)
        .eq("user_id", normalUserId)
        .single();
      expect(row!.user_pending).toBe(false);
    });

    it("approves a pending member", async () => {
      const form = new FormData();
      form.append("action", "approve");
      form.append("user_id", pendingUserId);
      const res = await app.request(`/admin/groups/${groupId}/members`, {
        method: "POST",
        body: form,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: row } = await adminDb
        .from("user_group")
        .select("user_pending")
        .eq("group_id", groupId)
        .eq("user_id", pendingUserId)
        .single();
      expect(row!.user_pending).toBe(false);
    });

    it("removes a member", async () => {
      const form = new FormData();
      form.append("action", "remove");
      form.append("user_id", memberUserId);
      const res = await app.request(`/admin/groups/${groupId}/members`, {
        method: "POST",
        body: form,
        headers: admHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: row } = await adminDb
        .from("user_group")
        .select("user_pending")
        .eq("group_id", groupId)
        .eq("user_id", memberUserId)
        .maybeSingle();
      expect(row).toBeNull();
    });

    it("rejects adding a nonexistent user", async () => {
      const form = new FormData();
      form.append("action", "add");
      form.append("username", "GroupsNoOneNamedThis");
      const res = await app.request(`/admin/groups/${groupId}/members`, {
        method: "POST",
        body: form,
        headers: admHeaders(),
      });
      expect(res.status).toBe(400);
    });

    it("returns 403 for non-admin on members page", async () => {
      const res = await app.request(`/admin/groups/${groupId}/members`, {
        headers: normalHeaders(),
      });
      expect(res.status).toBe(403);
    });
  });

  describe("auth-page filter regression", () => {
    let singleUserGroupId: number;

    beforeAll(async () => {
      const { data: group } = await adminDb
        .from("groups")
        .insert({
          group_name: "GroupsAuthFilterSU",
          group_type: 1,
          group_description: "",
          group_single_user: true,
        })
        .select()
        .single();
      singleUserGroupId = group!.id;
      createdGroupIds.push(singleUserGroupId);
    });

    it("/admin/auth landing omits single-user groups", async () => {
      const res = await app.request("/admin/auth", { headers: admHeaders() });
      const html = await res.text();
      expect(html).not.toContain("GroupsAuthFilterSU");
    });

    it("/admin/auth/group/:id returns 404 for a single-user group", async () => {
      const res = await app.request(`/admin/auth/group/${singleUserGroupId}`, {
        headers: admHeaders(),
      });
      expect(res.status).toBe(404);
    });
  });
});
