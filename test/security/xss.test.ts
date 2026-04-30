import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";

config({ path: ".env" });

let adminDb: SupabaseClient;
const cleanup: (() => Promise<void>)[] = [];

beforeAll(() => {
  adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
});

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

const PAYLOAD = "<script>alert('xss')</script>";
const ESCAPED = "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;";

describe("XSS — user-controlled fields are escaped at render time", () => {
  it("usernames containing <script> are escaped on the forum index", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const username = `${PAYLOAD}_${suffix}`.slice(0, 25);
    const { data: authData } = await adminDb.auth.admin.createUser({
      email: `xss-username-${suffix}@plank.local`,
      password: "testpass-xss-1234",
      email_confirm: true,
    });
    const userId = authData.user!.id;
    cleanup.push(async () => { await adminDb.auth.admin.deleteUser(userId); });
    await adminDb.from("profiles").insert({ id: userId, username });

    const html = await (await app.request("/")).text();
    expect(html).not.toContain(PAYLOAD);
  });

  it("forum names containing HTML are escaped on the forum index", async () => {
    const { data: cat } = await adminDb
      .from("categories")
      .insert({ cat_title: "XSS test cat", cat_order: 9999 })
      .select("id")
      .single();
    const { data: forum } = await adminDb
      .from("forums")
      .insert({
        cat_id: cat!.id,
        forum_name: PAYLOAD,
        forum_desc: PAYLOAD,
        forum_order: 9999,
      })
      .select("id")
      .single();
    cleanup.push(async () => {
      await adminDb.from("forums").delete().eq("id", forum!.id);
      await adminDb.from("categories").delete().eq("id", cat!.id);
    });

    const html = await (await app.request("/")).text();
    expect(html).not.toContain(PAYLOAD);
    expect(html).toContain(ESCAPED);
  });

  it("topic titles are escaped on the forum view", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const { data: authData } = await adminDb.auth.admin.createUser({
      email: `xss-topic-${suffix}@plank.local`,
      password: "testpass-xss-1234",
      email_confirm: true,
    });
    const userId = authData.user!.id;
    await adminDb.from("profiles").insert({ id: userId, username: `xss_poster_${suffix}` });
    const { data: forums } = await adminDb.from("forums").select("id").limit(1);
    const forumId = forums![0].id;
    const { data: topic } = await adminDb
      .from("topics")
      .insert({
        forum_id: forumId,
        topic_title: PAYLOAD,
        topic_poster: userId,
      })
      .select("id")
      .single();
    cleanup.push(async () => {
      await adminDb.from("topics").delete().eq("id", topic!.id);
      await adminDb.auth.admin.deleteUser(userId);
    });

    const html = await (await app.request(`/viewforum/${forumId}`)).text();
    expect(html).not.toContain(PAYLOAD);
    expect(html).toContain(ESCAPED);
  });
});
