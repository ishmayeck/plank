import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";
import { cleanupTestUser } from "../util/users.js";

/**
 * Chunk 20 end-to-end: the same stored instant must render in each viewer's
 * own timezone and preferred format, on real pages.
 *
 * The unit tests in test/lib/datetime.test.ts prove the formatter. This
 * proves it's actually reached — the preference columns existed and were
 * collected by the profile form for months while every page rendered UTC.
 */

config({ path: ".env" });

let adminDb: SupabaseClient;
let categoryId: number;
let forumId: number;
let topicId: number;

// A fixed instant with an unambiguous rendering in each zone.
const POST_TIME = "2026-03-14T15:45:30.000Z";

interface Viewer {
  id: string;
  access: string;
  refresh: string;
}

const viewers: Record<string, Viewer> = {};

async function createViewer(
  username: string,
  email: string,
  timezone: string,
  dateformat: string
): Promise<Viewer> {
  await cleanupTestUser(adminDb, username, email);
  const { data } = await adminDb.auth.admin.createUser({
    email,
    password: "tz-test-pass-1234",
    email_confirm: true,
  });
  const id = data.user!.id;
  await adminDb.from("profiles").insert({
    id,
    username,
    user_timezone: timezone,
    user_dateformat: dateformat,
  });

  const form = new FormData();
  form.append("username", username);
  form.append("password", "tz-test-pass-1234");
  const res = await app.request("/login", { method: "POST", body: form });
  const cookies = res.headers.getSetCookie();
  return {
    id,
    access: cookies
      .find((c) => c.startsWith("sb-access-token="))!
      .substring("sb-access-token=".length)
      .split(";")[0],
    refresh: cookies
      .find((c) => c.startsWith("sb-refresh-token="))!
      .substring("sb-refresh-token=".length)
      .split(";")[0],
  };
}

function as(v: Viewer): HeadersInit {
  return { Cookie: `sb-access-token=${v.access}; sb-refresh-token=${v.refresh}` };
}

beforeAll(async () => {
  adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  viewers.utc = await createViewer(
    "TzUtc", "tz-utc@plank.local", "UTC", "D M d, Y g:i a"
  );
  viewers.la = await createViewer(
    "TzLosAngeles", "tz-la@plank.local", "America/Los_Angeles", "D M d, Y g:i a"
  );
  viewers.tokyo = await createViewer(
    "TzTokyo", "tz-tokyo@plank.local", "Asia/Tokyo", "D M d, Y g:i a"
  );
  viewers.iso = await createViewer(
    "TzIso", "tz-iso@plank.local", "UTC", "Y-m-d H:i"
  );

  const { data: cat } = await adminDb
    .from("categories")
    .insert({ cat_title: "TZ Category", cat_order: 9997 })
    .select()
    .single();
  categoryId = cat!.id;

  const { data: forum } = await adminDb
    .from("forums")
    .insert({
      cat_id: categoryId,
      forum_name: "TZ Forum",
      forum_desc: "",
      forum_order: 9997,
    })
    .select()
    .single();
  forumId = forum!.id;

  const { data: topic } = await adminDb
    .from("topics")
    .insert({
      forum_id: forumId,
      topic_title: "TZ Topic",
      topic_poster: viewers.utc.id,
      topic_time: POST_TIME,
    })
    .select()
    .single();
  topicId = topic!.id;

  const { data: post } = await adminDb
    .from("posts")
    .insert({
      topic_id: topicId,
      forum_id: forumId,
      poster_id: viewers.utc.id,
      post_time: POST_TIME,
    })
    .select()
    .single();
  await adminDb
    .from("posts_text")
    .insert({ post_id: post!.id, post_subject: "TZ Topic", post_text: "body" });
});

afterAll(async () => {
  await adminDb.from("forums").delete().eq("id", forumId);
  await adminDb.from("categories").delete().eq("id", categoryId);
  for (const v of Object.values(viewers)) {
    await adminDb.auth.admin.deleteUser(v.id).catch(() => {});
  }
});

describe("post times render in each viewer's timezone", () => {
  it("shows UTC to a UTC viewer", async () => {
    const html = await (
      await app.request(`/viewtopic/${topicId}`, { headers: as(viewers.utc) })
    ).text();
    expect(html).toContain("Sat Mar 14, 2026 3:45 pm");
  });

  it("shows the same instant in the morning to a Los Angeles viewer", async () => {
    const html = await (
      await app.request(`/viewtopic/${topicId}`, { headers: as(viewers.la) })
    ).text();
    expect(html).toContain("Sat Mar 14, 2026 8:45 am");
    expect(html).not.toContain("Sat Mar 14, 2026 3:45 pm");
  });

  it("shows the same instant on the next day to a Tokyo viewer", async () => {
    const html = await (
      await app.request(`/viewtopic/${topicId}`, { headers: as(viewers.tokyo) })
    ).text();
    expect(html).toContain("Sun Mar 15, 2026 12:45 am");
  });

  it("shows UTC to a logged-out visitor", async () => {
    const html = await (await app.request(`/viewtopic/${topicId}`)).text();
    expect(html).toContain("Sat Mar 14, 2026 3:45 pm");
  });
});

describe("date format preference is honoured", () => {
  it("renders the viewer's own format string", async () => {
    const html = await (
      await app.request(`/viewtopic/${topicId}`, { headers: as(viewers.iso) })
    ).text();
    expect(html).toContain("2026-03-14 15:45");
    expect(html).not.toContain("Sat Mar 14, 2026 3:45 pm");
  });
});

describe("the timezone footer reflects the viewer", () => {
  it("names the viewer's own zone", async () => {
    // Intl's short name is an abbreviation where one exists (EDT) and an
    // offset otherwise (GMT+9) — assert the exact string, since "GMT+9"
    // trivially contains "GMT".
    const html = await (
      await app.request(`/viewtopic/${topicId}`, { headers: as(viewers.tokyo) })
    ).text();
    expect(html).toContain("All times are GMT+9");
  });

  it("says UTC to a logged-out visitor", async () => {
    const html = await (await app.request(`/viewtopic/${topicId}`)).text();
    expect(html).toContain("All times are UTC");
  });
});

describe("the profile form offers and persists the preferences", () => {
  it("renders a real timezone select with the current zone chosen", async () => {
    const html = await (
      await app.request("/profile", { headers: as(viewers.tokyo) })
    ).text();
    expect(html).toContain('name="timezone"');
    expect(html).toContain("Asia/Tokyo");
    expect(html).toMatch(/Asia\/Tokyo"\s+selected/);
  });

  it("saves a changed timezone and applies it immediately", async () => {
    const form = new FormData();
    form.append("timezone", "Europe/Paris");
    form.append("dateformat", "Y-m-d H:i");
    form.append("location", "");
    await app.request("/profile", {
      method: "POST",
      body: form,
      headers: as(viewers.la),
    });

    const { data } = await adminDb
      .from("profiles")
      .select("user_timezone, user_dateformat")
      .eq("id", viewers.la.id)
      .maybeSingle();
    expect(data!.user_timezone).toBe("Europe/Paris");
    expect(data!.user_dateformat).toBe("Y-m-d H:i");

    // Paris is UTC+1 in March before EU DST starts on the 29th.
    const html = await (
      await app.request(`/viewtopic/${topicId}`, { headers: as(viewers.la) })
    ).text();
    expect(html).toContain("2026-03-14 16:45");
  });

  it("rejects a junk timezone rather than storing it", async () => {
    const form = new FormData();
    form.append("timezone", "Mars/Olympus_Mons");
    form.append("dateformat", "Y-m-d H:i");
    form.append("location", "");
    await app.request("/profile", {
      method: "POST",
      body: form,
      headers: as(viewers.iso),
    });

    const { data } = await adminDb
      .from("profiles")
      .select("user_timezone")
      .eq("id", viewers.iso.id)
      .maybeSingle();
    expect(data!.user_timezone).toBe("UTC");
  });
});
