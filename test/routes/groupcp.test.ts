import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";

config({ path: ".env" });

let adminDb: SupabaseClient;
let user1Id: string;
let user2Id: string;
let modUserId: string;
let user1Access: string;
let user1Refresh: string;
let user2Access: string;
let user2Refresh: string;
let modAccess: string;
let modRefresh: string;
let openGroupId: number;
let closedGroupId: number;
let hiddenGroupId: number;

async function cleanupUser(username: string) {
  const { data } = await adminDb
    .from("profiles")
    .select("id")
    .eq("username", username)
    .single();
  if (data) {
    await adminDb.from("user_group").delete().eq("user_id", data.id);
    await adminDb.from("groups").delete().eq("group_moderator", data.id);
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

  // Cleanup
  await cleanupUser("GrpUser1");
  await cleanupUser("GrpUser2");
  await cleanupUser("GrpMod");

  // Cleanup old test groups
  await adminDb.from("groups").delete().eq("group_name", "Test Open Group");
  await adminDb.from("groups").delete().eq("group_name", "Test Closed Group");
  await adminDb.from("groups").delete().eq("group_name", "Test Hidden Group");

  // Create users
  const u1 = await createAndLogin("GrpUser1", "grpuser1@plank.local", "testpass123");
  user1Id = u1.userId;
  user1Access = u1.access;
  user1Refresh = u1.refresh;

  const u2 = await createAndLogin("GrpUser2", "grpuser2@plank.local", "testpass123");
  user2Id = u2.userId;
  user2Access = u2.access;
  user2Refresh = u2.refresh;

  const mod = await createAndLogin("GrpMod", "grpmod@plank.local", "testpass123", 1);
  modUserId = mod.userId;
  modAccess = mod.access;
  modRefresh = mod.refresh;

  // Create test groups
  const { data: openG } = await adminDb
    .from("groups")
    .insert({
      group_name: "Test Open Group",
      group_description: "An open group for testing",
      group_type: 0,
      group_moderator: modUserId,
    })
    .select()
    .single();
  openGroupId = openG!.id;

  const { data: closedG } = await adminDb
    .from("groups")
    .insert({
      group_name: "Test Closed Group",
      group_description: "A closed group for testing",
      group_type: 1,
      group_moderator: modUserId,
    })
    .select()
    .single();
  closedGroupId = closedG!.id;

  const { data: hiddenG } = await adminDb
    .from("groups")
    .insert({
      group_name: "Test Hidden Group",
      group_description: "A hidden group for testing",
      group_type: 2,
      group_moderator: modUserId,
    })
    .select()
    .single();
  hiddenGroupId = hiddenG!.id;

  // Add mod to groups as moderator/member
  await adminDb.from("user_group").insert({ group_id: openGroupId, user_id: modUserId });
  await adminDb.from("user_group").insert({ group_id: closedGroupId, user_id: modUserId });
  await adminDb.from("user_group").insert({ group_id: hiddenGroupId, user_id: modUserId });
});

afterAll(async () => {
  await adminDb.from("user_group").delete().eq("user_id", user1Id);
  await adminDb.from("user_group").delete().eq("user_id", user2Id);
  await adminDb.from("user_group").delete().eq("user_id", modUserId);
  await adminDb.from("groups").delete().eq("id", openGroupId);
  await adminDb.from("groups").delete().eq("id", closedGroupId);
  await adminDb.from("groups").delete().eq("id", hiddenGroupId);
  await adminDb.auth.admin.deleteUser(user1Id);
  await adminDb.auth.admin.deleteUser(user2Id);
  await adminDb.auth.admin.deleteUser(modUserId);
});

function user1Headers(): HeadersInit {
  return { Cookie: `sb-access-token=${user1Access}; sb-refresh-token=${user1Refresh}` };
}

function user2Headers(): HeadersInit {
  return { Cookie: `sb-access-token=${user2Access}; sb-refresh-token=${user2Refresh}` };
}

function modHeaders(): HeadersInit {
  return { Cookie: `sb-access-token=${modAccess}; sb-refresh-token=${modRefresh}` };
}

describe("User Groups", () => {
  describe("group list", () => {
    it("redirects to login for unauthenticated users", async () => {
      const res = await app.request("/groupcp");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });

    it("shows group list for authenticated users", async () => {
      const res = await app.request("/groupcp", { headers: user1Headers() });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Test Open Group");
      expect(html).toContain("Test Closed Group");
      // Hidden group should not appear
      expect(html).not.toContain("Test Hidden Group");
    });
  });

  describe("group info", () => {
    it("shows group info page", async () => {
      const res = await app.request(`/groupcp?g=${openGroupId}`, {
        headers: user1Headers(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Test Open Group");
      expect(html).toContain("An open group for testing");
      expect(html).toContain("GrpMod");
    });

    it("hides hidden group from non-members", async () => {
      const res = await app.request(`/groupcp?g=${hiddenGroupId}`, {
        headers: user1Headers(),
      });
      expect(res.status).toBe(404);
    });

    it("shows hidden group to members", async () => {
      const res = await app.request(`/groupcp?g=${hiddenGroupId}`, {
        headers: modHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Test Hidden Group");
    });
  });

  describe("join open group", () => {
    it("joins an open group immediately", async () => {
      const formData = new FormData();
      formData.append("g", String(openGroupId));
      formData.append("joingroup", "Join Group");

      const res = await app.request("/groupcp", {
        method: "POST",
        body: formData,
        headers: user1Headers(),
      });
      expect(res.status).toBe(302);

      const { data: membership } = await adminDb
        .from("user_group")
        .select("user_pending")
        .eq("group_id", openGroupId)
        .eq("user_id", user1Id)
        .single();
      expect(membership).not.toBeNull();
      expect(membership!.user_pending).toBe(false);
    });

    it("shows member status after joining", async () => {
      const res = await app.request(`/groupcp?g=${openGroupId}`, {
        headers: user1Headers(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("You are a member of this group");
    });
  });

  describe("join closed group (pending)", () => {
    it("requests membership in a closed group", async () => {
      const formData = new FormData();
      formData.append("g", String(closedGroupId));
      formData.append("joingroup", "Join Group");

      const res = await app.request("/groupcp", {
        method: "POST",
        body: formData,
        headers: user2Headers(),
      });
      expect(res.status).toBe(302);

      const { data: membership } = await adminDb
        .from("user_group")
        .select("user_pending")
        .eq("group_id", closedGroupId)
        .eq("user_id", user2Id)
        .single();
      expect(membership).not.toBeNull();
      expect(membership!.user_pending).toBe(true);
    });

    it("shows pending status", async () => {
      const res = await app.request(`/groupcp?g=${closedGroupId}`, {
        headers: user2Headers(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("pending");
    });
  });

  describe("group moderator actions", () => {
    it("shows pending members to group mod", async () => {
      const res = await app.request(`/groupcp?g=${closedGroupId}`, {
        headers: modHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("GrpUser2");
      expect(html).toContain("Pending Members");
    });

    it("approves pending member", async () => {
      const formData = new FormData();
      formData.append("g", String(closedGroupId));
      formData.append("pending_members[]", user2Id);
      formData.append("approve", "Approve Selected");

      const res = await app.request("/groupcp", {
        method: "POST",
        body: formData,
        headers: modHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: membership } = await adminDb
        .from("user_group")
        .select("user_pending")
        .eq("group_id", closedGroupId)
        .eq("user_id", user2Id)
        .single();
      expect(membership!.user_pending).toBe(false);
    });

    it("adds a member directly", async () => {
      const formData = new FormData();
      formData.append("g", String(openGroupId));
      formData.append("username", "GrpUser2");
      formData.append("add", "Add Member");

      const res = await app.request("/groupcp", {
        method: "POST",
        body: formData,
        headers: modHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: membership } = await adminDb
        .from("user_group")
        .select("user_pending")
        .eq("group_id", openGroupId)
        .eq("user_id", user2Id)
        .single();
      expect(membership).not.toBeNull();
      expect(membership!.user_pending).toBe(false);
    });

    it("removes a member", async () => {
      const formData = new FormData();
      formData.append("g", String(openGroupId));
      formData.append("members[]", user2Id);
      formData.append("remove", "Remove Selected");

      const res = await app.request("/groupcp", {
        method: "POST",
        body: formData,
        headers: modHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: membership } = await adminDb
        .from("user_group")
        .select("user_pending")
        .eq("group_id", openGroupId)
        .eq("user_id", user2Id)
        .single();
      expect(membership).toBeNull();
    });
  });

  describe("unsubscribe", () => {
    it("leaves a group", async () => {
      const formData = new FormData();
      formData.append("g", String(openGroupId));
      formData.append("unsub", "Unsubscribe");

      const res = await app.request("/groupcp", {
        method: "POST",
        body: formData,
        headers: user1Headers(),
      });
      expect(res.status).toBe(302);

      const { data: membership } = await adminDb
        .from("user_group")
        .select("user_pending")
        .eq("group_id", openGroupId)
        .eq("user_id", user1Id)
        .single();
      expect(membership).toBeNull();
    });
  });

  describe("update group type", () => {
    it("allows group mod to change group type", async () => {
      const formData = new FormData();
      formData.append("g", String(openGroupId));
      formData.append("group_type", "1"); // Change to closed
      formData.append("groupstatus", "Update");

      const res = await app.request("/groupcp", {
        method: "POST",
        body: formData,
        headers: modHeaders(),
      });
      expect(res.status).toBe(302);

      const { data: group } = await adminDb
        .from("groups")
        .select("group_type")
        .eq("id", openGroupId)
        .single();
      expect(group!.group_type).toBe(1);

      // Revert
      await adminDb.from("groups").update({ group_type: 0 }).eq("id", openGroupId);
    });

    it("rejects group type change from non-mod", async () => {
      const formData = new FormData();
      formData.append("g", String(openGroupId));
      formData.append("group_type", "1");
      formData.append("groupstatus", "Update");

      const res = await app.request("/groupcp", {
        method: "POST",
        body: formData,
        headers: user1Headers(),
      });
      expect(res.status).toBe(403);
    });
  });
});
