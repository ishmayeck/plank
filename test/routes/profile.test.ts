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
      expect(res.headers.get("location")).toMatch(/^\/login/);
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

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Your profile has been updated");
      expect(html).toContain("return to the Index");

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

    it("rejects avatar uploads that exceed the dimension limit", async () => {
      // Build a minimal PNG header that advertises 300x300. image-size only
      // reads the IHDR chunk, so we don't need a valid CRC or pixel data —
      // and we don't want a 300x300 worth of pixels in the test fixture.
      const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const ihdrLen = Buffer.from([0, 0, 0, 13]);
      const ihdrType = Buffer.from("IHDR", "ascii");
      const widthBuf = Buffer.alloc(4); widthBuf.writeUInt32BE(300);
      const heightBuf = Buffer.alloc(4); heightBuf.writeUInt32BE(300);
      const ihdrTail = Buffer.from([0x08, 0x02, 0x00, 0x00, 0x00]); // 8-bit RGB
      const crc = Buffer.alloc(4);
      const png = Buffer.concat([sig, ihdrLen, ihdrType, widthBuf, heightBuf, ihdrTail, crc]);

      const formData = new FormData();
      formData.append("location", "Test City");
      formData.append(
        "avatar",
        new File([png], "huge.png", { type: "image/png" })
      );

      const res = await app.request("/profile", {
        method: "POST",
        body: formData,
        headers: authHeaders(),
      });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("dimensions are too large");
      expect(html).toContain("300x300");

      // Avatar should not have been recorded on the profile.
      const { data: profile } = await adminDb
        .from("profiles")
        .select("user_avatar")
        .eq("id", testUserId)
        .single();
      expect(profile!.user_avatar ?? "").not.toContain("huge.png");
    });

    it("accepts avatar uploads within the dimension limit", async () => {
      // 50x50 PNG header — well within the 200x200 default.
      const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const ihdrLen = Buffer.from([0, 0, 0, 13]);
      const ihdrType = Buffer.from("IHDR", "ascii");
      const widthBuf = Buffer.alloc(4); widthBuf.writeUInt32BE(50);
      const heightBuf = Buffer.alloc(4); heightBuf.writeUInt32BE(50);
      const ihdrTail = Buffer.from([0x08, 0x02, 0x00, 0x00, 0x00]);
      const crc = Buffer.alloc(4);
      const png = Buffer.concat([sig, ihdrLen, ihdrType, widthBuf, heightBuf, ihdrTail, crc]);

      const formData = new FormData();
      formData.append("location", "Test City");
      formData.append(
        "avatar",
        new File([png], "ok.png", { type: "image/png" })
      );

      const res = await app.request("/profile", {
        method: "POST",
        body: formData,
        headers: authHeaders(),
      });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).not.toContain("dimensions are too large");
      expect(html).toContain("Your profile has been updated");
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
