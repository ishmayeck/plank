import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";
import { cleanupTestUser } from "../util/users.js";

/**
 * Insecure-direct-object-reference coverage: can user A reach user B's row by
 * guessing an id?
 *
 * Every case here is a route that fetches a record by an id from the request
 * and must verify the record belongs to the requester. The bugs this covers
 * were all "the check exists in one handler and was not repeated in a
 * sibling" — so the tests deliberately exercise EVERY path to a private
 * message, not a representative one.
 */

config({ path: ".env" });

let adminDb: SupabaseClient;

let aliceId: string, aliceAccess: string, aliceRefresh: string;
let bobId: string, bobAccess: string, bobRefresh: string;
let malloryId: string, malloryAccess: string, malloryRefresh: string;

let pmId: number; // Alice → Bob. Mallory is a party to neither side.

const PM_SUBJECT = "IdorPmSubjectMarkerXYZ";
const PM_BODY = "IdorPmBodyMarkerXYZ";

async function createAndLogin(
  username: string,
  email: string,
  userLevel = 0
): Promise<{ userId: string; access: string; refresh: string }> {
  await cleanupTestUser(adminDb, username, email);
  const { data, error } = await adminDb.auth.admin.createUser({
    email,
    password: "idor-test-pass-1234",
    email_confirm: true,
  });
  if (error || !data?.user) {
    throw new Error(`createUser(${email}) failed: ${error?.message ?? "no user"}`);
  }
  const userId = data.user.id;
  await adminDb.from("profiles").insert({ id: userId, username, user_level: userLevel });

  const form = new FormData();
  form.append("username", username);
  form.append("password", "idor-test-pass-1234");
  const res = await app.request("/login", { method: "POST", body: form });
  const setCookies = res.headers.getSetCookie();
  const access = setCookies
    .find((x) => x.startsWith("sb-access-token="))!
    .substring("sb-access-token=".length)
    .split(";")[0];
  const refresh = setCookies
    .find((x) => x.startsWith("sb-refresh-token="))!
    .substring("sb-refresh-token=".length)
    .split(";")[0];
  return { userId, access, refresh };
}

function cookies(access: string, refresh: string): HeadersInit {
  return { Cookie: `sb-access-token=${access}; sb-refresh-token=${refresh}` };
}

beforeAll(async () => {
  adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const a = await createAndLogin("IdorAlice", "idor-alice@plank.local");
  aliceId = a.userId; aliceAccess = a.access; aliceRefresh = a.refresh;
  const b = await createAndLogin("IdorBob", "idor-bob@plank.local");
  bobId = b.userId; bobAccess = b.access; bobRefresh = b.refresh;
  const m = await createAndLogin("IdorMallory", "idor-mallory@plank.local");
  malloryId = m.userId; malloryAccess = m.access; malloryRefresh = m.refresh;

  const { data: pm } = await adminDb
    .from("privmsgs")
    .insert({
      privmsgs_type: 0, // unread, in Bob's inbox
      privmsgs_subject: PM_SUBJECT,
      privmsgs_from_userid: aliceId,
      privmsgs_to_userid: bobId,
    })
    .select()
    .single();
  pmId = pm!.id;
  await adminDb.from("privmsgs_text").insert({
    privmsgs_text_id: pmId,
    privmsgs_text: PM_BODY,
  });
});

afterAll(async () => {
  await adminDb.from("privmsgs").delete().eq("id", pmId);
  for (const id of [aliceId, bobId, malloryId]) {
    await adminDb.auth.admin.deleteUser(id).catch(() => {});
  }
});

describe("Private messages are only reachable by their sender and recipient", () => {
  it("lets the recipient read it", async () => {
    const res = await app.request(`/privmsg?mode=read&p=${pmId}`, {
      headers: cookies(bobAccess, bobRefresh),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(PM_BODY);
  });

  it("lets the sender read it", async () => {
    const res = await app.request(`/privmsg?mode=read&p=${pmId}`, {
      headers: cookies(aliceAccess, aliceRefresh),
    });
    expect(res.status).toBe(200);
  });

  it("does not let a third party read it", async () => {
    const res = await app.request(`/privmsg?mode=read&p=${pmId}`, {
      headers: cookies(malloryAccess, malloryRefresh),
    });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(PM_BODY);
  });

  it("returns the same 404 for a nonexistent id as for someone else's message", async () => {
    // Otherwise the status code maps out which ids exist.
    const mine = await app.request(`/privmsg?mode=read&p=${pmId}`, {
      headers: cookies(malloryAccess, malloryRefresh),
    });
    const missing = await app.request("/privmsg?mode=read&p=99999999", {
      headers: cookies(malloryAccess, malloryRefresh),
    });
    expect(missing.status).toBe(mine.status);
  });

  it("does not leak the body through the reply form", async () => {
    const res = await app.request(`/privmsg?mode=post&p=${pmId}`, {
      headers: cookies(malloryAccess, malloryRefresh),
    });
    const html = await res.text();
    expect(html).not.toContain(PM_BODY);
    expect(html).not.toContain(PM_SUBJECT);
  });

  it("does not leak the body through the quote form", async () => {
    // The quote path pre-filled the compose textarea with the quoted body.
    const res = await app.request(`/privmsg?mode=post&p=${pmId}&quote=1`, {
      headers: cookies(malloryAccess, malloryRefresh),
    });
    const html = await res.text();
    expect(html).not.toContain(PM_BODY);
    expect(html).not.toContain(PM_SUBJECT);
  });

  it("still quotes correctly for the actual recipient", async () => {
    const res = await app.request(`/privmsg?mode=post&p=${pmId}&quote=1`, {
      headers: cookies(bobAccess, bobRefresh),
    });
    expect(await res.text()).toContain(PM_BODY);
  });

  it("does not let a third party re-file it to the savebox", async () => {
    // Compare before/after rather than asserting a literal: reading the
    // message in an earlier test legitimately flips unread → read.
    const { data: before } = await adminDb
      .from("privmsgs")
      .select("privmsgs_type")
      .eq("id", pmId)
      .maybeSingle();

    const form = new FormData();
    form.append("save", "1");
    form.append("pm_id", String(pmId));
    await app.request("/privmsg", {
      method: "POST",
      body: form,
      headers: cookies(malloryAccess, malloryRefresh),
    });

    const { data: after } = await adminDb
      .from("privmsgs")
      .select("privmsgs_type")
      .eq("id", pmId)
      .maybeSingle();
    expect(after!.privmsgs_type).toBe(before!.privmsgs_type);
  });

  it("does not let a third party delete it", async () => {
    const form = new FormData();
    form.append("delete", "1");
    form.append("pm_id", String(pmId));
    await app.request("/privmsg", {
      method: "POST",
      body: form,
      headers: cookies(malloryAccess, malloryRefresh),
    });

    const { data: after } = await adminDb
      .from("privmsgs")
      .select("id")
      .eq("id", pmId)
      .maybeSingle();
    expect(after).not.toBeNull();
  });
});
