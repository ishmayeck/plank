import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";

config({ path: ".env" });

let adminDb: SupabaseClient;
const testUsers: string[] = [];

beforeAll(() => {
  adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
});

afterAll(async () => {
  // Clean up test users
  for (const userId of testUsers) {
    await adminDb.auth.admin.deleteUser(userId);
  }
});

async function createTestUser(username: string, email: string, password: string) {
  const { data } = await adminDb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  const userId = data.user!.id;
  testUsers.push(userId);
  await adminDb.from("profiles").insert({ id: userId, username });
  return userId;
}

describe("Authentication", () => {
  describe("login page", () => {
    it("renders the login form", async () => {
      const res = await app.request("/login");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Username");
      expect(html).toContain("Password");
      expect(html).toContain('action="/login"');
    });
  });

  describe("register page", () => {
    it("renders the registration form", async () => {
      const res = await app.request("/register");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Registration Information");
      expect(html).toContain('action="/register"');
    });
  });

  describe("registration flow", () => {
    it("creates a new user and redirects to index", async () => {
      const formData = new FormData();
      formData.append("username", "NewUser");
      formData.append("email", "newuser@plank.local");
      formData.append("new_password", "testpass123");
      formData.append("password_confirm", "testpass123");

      const res = await app.request("/register", {
        method: "POST",
        body: formData,
      });

      // Should redirect to /
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");

      // Should have set session cookies
      const cookies = res.headers.getSetCookie();
      expect(cookies.some((c) => c.startsWith("sb-access-token="))).toBe(true);
      expect(cookies.some((c) => c.startsWith("sb-refresh-token="))).toBe(true);

      // Clean up: find and track the user for deletion
      const { data: profile } = await adminDb
        .from("profiles")
        .select("id")
        .eq("username", "NewUser")
        .single();
      if (profile) testUsers.push(profile.id);
    });

    it("rejects registration with mismatched passwords", async () => {
      const formData = new FormData();
      formData.append("username", "BadUser");
      formData.append("email", "bad@plank.local");
      formData.append("new_password", "pass1");
      formData.append("password_confirm", "pass2");

      const res = await app.request("/register", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Passwords do not match");
    });

    it("rejects duplicate usernames", async () => {
      await createTestUser("DupeUser", "dupe@plank.local", "testpass123");

      const formData = new FormData();
      formData.append("username", "DupeUser");
      formData.append("email", "dupe2@plank.local");
      formData.append("new_password", "testpass123");
      formData.append("password_confirm", "testpass123");

      const res = await app.request("/register", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("already taken");
    });
  });

  describe("login flow", () => {
    it("logs in with valid credentials", async () => {
      await createTestUser("LoginUser", "loginuser@plank.local", "mypassword");

      const formData = new FormData();
      formData.append("username", "LoginUser");
      formData.append("password", "mypassword");

      const res = await app.request("/login", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");

      const cookies = res.headers.getSetCookie();
      expect(cookies.some((c) => c.startsWith("sb-access-token="))).toBe(true);
    });

    it("rejects invalid password", async () => {
      await createTestUser("BadLogin", "badlogin@plank.local", "rightpass");

      const formData = new FormData();
      formData.append("username", "BadLogin");
      formData.append("password", "wrongpass");

      const res = await app.request("/login", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("You have specified an incorrect or inactive username, or an invalid password.");
    });

    it("rejects nonexistent username", async () => {
      const formData = new FormData();
      formData.append("username", "NoSuchUser");
      formData.append("password", "whatever");

      const res = await app.request("/login", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("You have specified an incorrect or inactive username, or an invalid password.");
    });
  });

  describe("logout", () => {
    it("clears session and redirects", async () => {
      const res = await app.request("/logout");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");

      const cookies = res.headers.getSetCookie();
      // Cookies should be cleared (max-age=0 or empty value)
      const accessCookie = cookies.find((c) => c.startsWith("sb-access-token="));
      if (accessCookie) {
        expect(accessCookie).toContain("Max-Age=0");
      }
    });
  });

  describe("index page", () => {
    it("shows login form when logged out", async () => {
      const res = await app.request("/");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Plank Forum :: Index");
      expect(html).toContain("General Discussion");
    });
  });

  describe("unread PM counter in header", () => {
    it("shows the actual unread count and refreshes when a PM is marked read", async () => {
      const recipientPassword = "testpass-pm-counter";
      const recipientId = await createTestUser(
        "PMCounterRecipient",
        "pm-counter-recipient@plank.local",
        recipientPassword
      );
      const senderId = await createTestUser(
        "PMCounterSender",
        "pm-counter-sender@plank.local",
        "anything"
      );

      // Log recipient in
      const loginForm = new FormData();
      loginForm.append("username", "PMCounterRecipient");
      loginForm.append("password", recipientPassword);
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
      const headers: HeadersInit = {
        Cookie: `sb-access-token=${access}; sb-refresh-token=${refresh}`,
      };

      // No PMs yet — header should report none
      const before = await (await app.request("/", { headers })).text();
      expect(before).toContain("You have no new messages");

      // Send two unread PMs to the recipient
      const { data: pm1 } = await adminDb
        .from("privmsgs")
        .insert({
          privmsgs_type: 0,
          privmsgs_subject: "Hello",
          privmsgs_from_userid: senderId,
          privmsgs_to_userid: recipientId,
        })
        .select("id")
        .single();
      await adminDb.from("privmsgs_text").insert({
        privmsgs_text_id: pm1!.id,
        privmsgs_text: "First message",
      });
      const { data: pm2 } = await adminDb
        .from("privmsgs")
        .insert({
          privmsgs_type: 2,
          privmsgs_subject: "Hello again",
          privmsgs_from_userid: senderId,
          privmsgs_to_userid: recipientId,
        })
        .select("id")
        .single();
      await adminDb.from("privmsgs_text").insert({
        privmsgs_text_id: pm2!.id,
        privmsgs_text: "Second message",
      });

      const after = await (await app.request("/", { headers })).text();
      expect(after).toContain("You have <b>2</b> new messages");

      // Mark one read; counter drops to 1
      await adminDb.from("privmsgs").update({ privmsgs_type: 1 }).eq("id", pm1!.id);
      const afterRead = await (await app.request("/", { headers })).text();
      expect(afterRead).toContain("You have <b>1</b> new message");
    });
  });
});
