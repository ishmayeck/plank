import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";
import { cleanupTestUser } from "../util/users.js";

config({ path: ".env" });

let adminDb: SupabaseClient;
let senderUserId: string;
let recipientUserId: string;
let senderAccess: string;
let senderRefresh: string;
let recipientAccess: string;
let recipientRefresh: string;

const cleanupUser = (username: string, email?: string) =>
  cleanupTestUser(adminDb, username, email);

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

  await cleanupUser("PMSender", "pmsender@plank.local");
  await cleanupUser("PMRecipient", "pmrecipient@plank.local");

  const sender = await createAndLogin("PMSender", "pmsender@plank.local", "testpass123");
  senderUserId = sender.userId;
  senderAccess = sender.access;
  senderRefresh = sender.refresh;

  const recipient = await createAndLogin("PMRecipient", "pmrecipient@plank.local", "testpass123");
  recipientUserId = recipient.userId;
  recipientAccess = recipient.access;
  recipientRefresh = recipient.refresh;
});

afterAll(async () => {
  await adminDb.from("privmsgs").delete().eq("privmsgs_from_userid", senderUserId);
  await adminDb.from("privmsgs").delete().eq("privmsgs_to_userid", recipientUserId);
  await adminDb.auth.admin.deleteUser(senderUserId);
  await adminDb.auth.admin.deleteUser(recipientUserId);
});

function senderHeaders(): HeadersInit {
  return {
    Cookie: `sb-access-token=${senderAccess}; sb-refresh-token=${senderRefresh}`,
  };
}

function recipientHeaders(): HeadersInit {
  return {
    Cookie: `sb-access-token=${recipientAccess}; sb-refresh-token=${recipientRefresh}`,
  };
}

describe("Private Messaging", () => {
  describe("authentication", () => {
    it("redirects to login when not authenticated", async () => {
      const res = await app.request("/privmsg");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/^\/login/);
    });
  });

  describe("inbox", () => {
    it("renders empty inbox", async () => {
      const res = await app.request("/privmsg?folder=inbox", {
        headers: senderHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Private Messages");
      expect(html).toContain("You have no messages");
    });
  });

  describe("compose and send", () => {
    it("renders compose form", async () => {
      const res = await app.request("/privmsg?mode=post", {
        headers: senderHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Send a new private message");
      expect(html).toContain("Subject");
      expect(html).toContain("Message body");
    });

    it("renders compose form with recipient link", async () => {
      const res = await app.request(
        `/privmsg?mode=post&u=${recipientUserId}`,
        { headers: senderHeaders() }
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Send a new private message");
    });

    it("sends a PM and redirects", async () => {
      const formData = new FormData();
      formData.append("mode", "post");
      formData.append("username", "PMRecipient");
      formData.append("subject", "Test PM Subject");
      formData.append("message", "[b]Hello via PM![/b]");

      const res = await app.request("/privmsg", {
        method: "POST",
        body: formData,
        headers: senderHeaders(),
      });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Your message has been sent");
      expect(html).toContain("return to your Sentbox");

      // Verify PM was created
      const { data: pms } = await adminDb
        .from("privmsgs")
        .select("*")
        .eq("privmsgs_from_userid", senderUserId)
        .eq("privmsgs_to_userid", recipientUserId);
      expect(pms!.length).toBeGreaterThan(0);
      expect(pms![0].privmsgs_subject).toBe("Test PM Subject");
    });

    it("rejects PM with missing recipient", async () => {
      const formData = new FormData();
      formData.append("mode", "post");
      formData.append("username", "");
      formData.append("subject", "No Recipient");
      formData.append("message", "Test");

      const res = await app.request("/privmsg", {
        method: "POST",
        body: formData,
        headers: senderHeaders(),
      });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("All fields are required");
    });

    it("rejects PM to nonexistent user", async () => {
      const formData = new FormData();
      formData.append("mode", "post");
      formData.append("username", "NonexistentUser12345");
      formData.append("subject", "Test");
      formData.append("message", "Test");

      const res = await app.request("/privmsg", {
        method: "POST",
        body: formData,
        headers: senderHeaders(),
      });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("recipient could not be found");
    });
  });

  describe("reading PMs", () => {
    let testPmId: number;

    beforeAll(async () => {
      // Create a PM for reading tests
      const { data: pm } = await adminDb
        .from("privmsgs")
        .insert({
          privmsgs_type: 0, // unread
          privmsgs_subject: "Readable PM",
          privmsgs_from_userid: senderUserId,
          privmsgs_to_userid: recipientUserId,
        })
        .select()
        .single();
      testPmId = pm!.id;

      await adminDb.from("privmsgs_text").insert({
        privmsgs_text_id: testPmId,
        privmsgs_text: "[i]PM content here[/i]",
      });
    });

    it("shows PM in recipient inbox", async () => {
      const res = await app.request("/privmsg?folder=inbox", {
        headers: recipientHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Readable PM");
      expect(html).toContain("PMSender");
    });

    it("renders PM content", async () => {
      const res = await app.request(`/privmsg?mode=read&p=${testPmId}`, {
        headers: recipientHeaders(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Readable PM");
      expect(html).toContain("<em>PM content here</em>");
      expect(html).toContain("PMSender");
      expect(html).toContain("PMRecipient");
    });

    it("marks PM as read", async () => {
      // Re-read to trigger mark as read
      await app.request(`/privmsg?mode=read&p=${testPmId}`, {
        headers: recipientHeaders(),
      });

      const { data: pm } = await adminDb
        .from("privmsgs")
        .select("privmsgs_type")
        .eq("id", testPmId)
        .single();
      expect(pm!.privmsgs_type).toBe(1); // PM_READ
    });

    it("returns 404 for nonexistent PM", async () => {
      const res = await app.request("/privmsg?mode=read&p=99999", {
        headers: recipientHeaders(),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("delete PM", () => {
    it("deletes a PM from read view", async () => {
      // Create a PM to delete
      const { data: pm } = await adminDb
        .from("privmsgs")
        .insert({
          privmsgs_type: 1,
          privmsgs_subject: "PM To Delete",
          privmsgs_from_userid: senderUserId,
          privmsgs_to_userid: recipientUserId,
        })
        .select()
        .single();

      await adminDb.from("privmsgs_text").insert({
        privmsgs_text_id: pm!.id,
        privmsgs_text: "Delete me",
      });

      const formData = new FormData();
      formData.append("delete", "1");
      formData.append("pm_id", String(pm!.id));
      formData.append("folder", "inbox");

      const res = await app.request("/privmsg", {
        method: "POST",
        body: formData,
        headers: recipientHeaders(),
      });

      expect(res.status).toBe(302);

      // Verify deleted
      const { data: deleted } = await adminDb
        .from("privmsgs")
        .select("id")
        .eq("id", pm!.id)
        .single();
      expect(deleted).toBeNull();
    });
  });

  describe("save PM", () => {
    it("moves a PM to savebox", async () => {
      const { data: pm } = await adminDb
        .from("privmsgs")
        .insert({
          privmsgs_type: 1,
          privmsgs_subject: "PM To Save",
          privmsgs_from_userid: senderUserId,
          privmsgs_to_userid: recipientUserId,
        })
        .select()
        .single();

      await adminDb.from("privmsgs_text").insert({
        privmsgs_text_id: pm!.id,
        privmsgs_text: "Save me",
      });

      const formData = new FormData();
      formData.append("save", "1");
      formData.append("pm_id", String(pm!.id));

      const res = await app.request("/privmsg", {
        method: "POST",
        body: formData,
        headers: recipientHeaders(),
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/privmsg?folder=savebox");

      // Verify type changed to saved_in
      const { data: saved } = await adminDb
        .from("privmsgs")
        .select("privmsgs_type")
        .eq("id", pm!.id)
        .single();
      expect(saved!.privmsgs_type).toBe(4); // PM_SAVED_IN
    });
  });
});
