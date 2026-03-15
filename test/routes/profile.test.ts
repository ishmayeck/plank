import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";

config({ path: ".env" });

let adminDb: SupabaseClient;
let testUserId: string;
let accessToken: string;
let refreshToken: string;

beforeAll(async () => {
  adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Clean up any leftover test user
  const { data: existing } = await adminDb
    .from("profiles")
    .select("id")
    .eq("username", "ProfileTester")
    .single();
  if (existing) {
    await adminDb.auth.admin.deleteUser(existing.id);
  }

  // Create test user
  const { data: authData } = await adminDb.auth.admin.createUser({
    email: "profiletest@plank.local",
    password: "testpass123",
    email_confirm: true,
  });
  testUserId = authData.user!.id;
  await adminDb.from("profiles").insert({
    id: testUserId,
    username: "ProfileTester",
    user_from: "Test City",
    user_website: "https://example.com",
    user_occ: "Developer",
    user_interests: "Coding, Testing",
    user_sig: "[b]My Signature[/b]",
    user_viewemail: true,
  });

  // Sign in to get session cookies
  const loginForm = new FormData();
  loginForm.append("username", "ProfileTester");
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
  await adminDb.auth.admin.deleteUser(testUserId);
});

function authHeaders(): HeadersInit {
  return {
    Cookie: `sb-access-token=${accessToken}; sb-refresh-token=${refreshToken}`,
  };
}

describe("User Profiles", () => {
  describe("GET /profile/:id - view profile", () => {
    it("displays user profile information", async () => {
      const res = await app.request(`/profile/${testUserId}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("ProfileTester");
      expect(html).toContain("Test City");
      expect(html).toContain("https://example.com");
      expect(html).toContain("Developer");
      expect(html).toContain("Coding, Testing");
    });

    it("shows joined date and post count", async () => {
      const res = await app.request(`/profile/${testUserId}`);
      const html = await res.text();
      expect(html).toContain("Joined");
      expect(html).toContain("Total posts");
    });

    it("returns 404 for nonexistent user", async () => {
      const res = await app.request("/profile/00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /profile - edit own profile", () => {
    it("redirects to login when not authenticated", async () => {
      const res = await app.request("/profile");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });

    it("renders edit form with current values", async () => {
      const res = await app.request("/profile", { headers: authHeaders() });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Registration Information");
      expect(html).toContain("Test City");
      expect(html).toContain("https://example.com");
      expect(html).toContain("Developer");
      expect(html).toContain("Coding, Testing");
      expect(html).toContain("[b]My Signature[/b]");
    });
  });

  describe("POST /profile - update profile", () => {
    it("updates profile fields and redirects", async () => {
      const formData = new FormData();
      formData.append("location", "New City");
      formData.append("website", "https://new.example.com");
      formData.append("occupation", "Senior Developer");
      formData.append("interests", "More Coding");
      formData.append("signature", "[i]New sig[/i]");
      formData.append("viewemail", "0");
      formData.append("attachsig", "1");

      const res = await app.request("/profile", {
        method: "POST",
        body: formData,
        headers: authHeaders(),
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/profile/${testUserId}`);

      // Verify updates persisted
      const { data: updated } = await adminDb
        .from("profiles")
        .select("*")
        .eq("id", testUserId)
        .single();
      expect(updated!.user_from).toBe("New City");
      expect(updated!.user_website).toBe("https://new.example.com");
      expect(updated!.user_occ).toBe("Senior Developer");
      expect(updated!.user_interests).toBe("More Coding");
      expect(updated!.user_sig).toBe("[i]New sig[/i]");

      // Restore original values for other tests
      await adminDb
        .from("profiles")
        .update({
          user_from: "Test City",
          user_website: "https://example.com",
          user_occ: "Developer",
          user_interests: "Coding, Testing",
          user_sig: "[b]My Signature[/b]",
        })
        .eq("id", testUserId);
    });

    it("rejects mismatched passwords", async () => {
      const formData = new FormData();
      formData.append("new_password", "newpass1");
      formData.append("password_confirm", "newpass2");
      formData.append("location", "Test City");

      const res = await app.request("/profile", {
        method: "POST",
        body: formData,
        headers: authHeaders(),
      });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Passwords do not match");
    });
  });
});

describe("Member List", () => {
  it("renders the member list page", async () => {
    const res = await app.request("/memberlist");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ProfileTester");
    expect(html).toContain("Username");
    expect(html).toContain("Joined");
    expect(html).toContain("Posts");
  });

  it("links to user profiles", async () => {
    const res = await app.request("/memberlist");
    const html = await res.text();
    expect(html).toContain(`/profile/${testUserId}`);
  });

  it("shows location in member list", async () => {
    const res = await app.request("/memberlist");
    const html = await res.text();
    expect(html).toContain("Test City");
  });
});
