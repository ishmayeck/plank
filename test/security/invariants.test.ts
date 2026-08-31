import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupTestUser } from "../util/users.js";

/**
 * ROADMAP Chunk 24 names four invariants that must never be traded away:
 * escape-by-default, markup() discipline, CSRF tokens, ACL gates. This file
 * enforces the ones that can be checked by ENUMERATING a surface rather than
 * sampling it.
 *
 * That distinction is the whole point. The existing suites sample: they pick
 * a few representative routes and assert those behave. Every security bug
 * found in the August 2026 review was in a route the samples didn't include —
 * a second code path that forgot what its sibling remembered. A test that
 * walks every form, or every file, fails when the NEXT one is added.
 *
 * The CSRF sweep in particular closes a structural blind spot: vitest.config
 * sets SKIP_CSRF=1 for the whole suite so fixtures can POST without doing the
 * token dance, which means no other test can notice a form that forgot its
 * token. The poll ballot shipped without one and every vote was rejected in
 * production; nothing failed. This file turns the real middleware back on.
 */

process.env.SKIP_CSRF = "0";
const { default: app } = await import("../../src/app.js");

config({ path: ".env" });

let adminDb: SupabaseClient;
let adminUserId: string;
let adminAccess: string;
let adminRefresh: string;
let categoryId: number;
let forumId: number;
let topicId: number;

const ADMIN_USERNAME = "InvariantAdmin";
const ADMIN_EMAIL = "invariant-admin@plank.local";
const ADMIN_PASSWORD = "invariant-pass-1234";

/** Log in for real: seed the csrf cookie from a GET, then POST with it. */
async function loginWithCsrf(username: string, password: string) {
  const seed = await app.request("/", { headers: { Origin: "http://localhost" } });
  const csrfCookie = seed.headers
    .getSetCookie()
    .find((x) => x.startsWith("plank-csrf="))!;
  const token = csrfCookie.split(";")[0].split("=")[1];

  const form = new FormData();
  form.append("username", username);
  form.append("password", password);
  form.append("_csrf", token);

  const res = await app.request("/login", {
    method: "POST",
    body: form,
    headers: { Origin: "http://localhost", Cookie: `plank-csrf=${token}` },
  });
  if (res.status !== 302) {
    throw new Error(`login failed: ${res.status} ${await res.text()}`);
  }
  const setCookies = res.headers.getSetCookie();
  return {
    access: setCookies
      .find((x) => x.startsWith("sb-access-token="))!
      .substring("sb-access-token=".length)
      .split(";")[0],
    refresh: setCookies
      .find((x) => x.startsWith("sb-refresh-token="))!
      .substring("sb-refresh-token=".length)
      .split(";")[0],
  };
}

beforeAll(async () => {
  adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  await cleanupTestUser(adminDb, ADMIN_USERNAME, ADMIN_EMAIL);
  const { data } = await adminDb.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
  });
  adminUserId = data.user!.id;
  await adminDb
    .from("profiles")
    .insert({ id: adminUserId, username: ADMIN_USERNAME, user_level: 1 });

  const { data: cat } = await adminDb
    .from("categories")
    .insert({ cat_title: "Invariant Category", cat_order: 9998 })
    .select()
    .single();
  categoryId = cat!.id;

  const { data: forum } = await adminDb
    .from("forums")
    .insert({
      cat_id: categoryId,
      forum_name: "Invariant Forum",
      forum_desc: "",
      forum_order: 9998,
    })
    .select()
    .single();
  forumId = forum!.id;

  const { data: topic } = await adminDb
    .from("topics")
    .insert({
      forum_id: forumId,
      topic_title: "Invariant Topic",
      topic_poster: adminUserId,
      topic_vote: 1,
    })
    .select()
    .single();
  topicId = topic!.id;

  const { data: post } = await adminDb
    .from("posts")
    .insert({ topic_id: topicId, forum_id: forumId, poster_id: adminUserId })
    .select()
    .single();
  await adminDb
    .from("posts_text")
    .insert({ post_id: post!.id, post_subject: "Invariant Topic", post_text: "body" });

  // A poll, so the ballot form is rendered on /viewtopic and included in the
  // sweep. This is the form that shipped without a token.
  const { data: poll } = await adminDb
    .from("poll_questions")
    .insert({ topic_id: topicId, poll_text: "Invariant poll?", poll_length: 0 })
    .select()
    .single();
  await adminDb.from("poll_options").insert([
    { poll_id: poll!.id, option_text: "Yes", option_order: 0 },
    { poll_id: poll!.id, option_text: "No", option_order: 1 },
  ]);

  const session = await loginWithCsrf(ADMIN_USERNAME, ADMIN_PASSWORD);
  adminAccess = session.access;
  adminRefresh = session.refresh;
});

afterAll(async () => {
  await adminDb.from("forums").delete().eq("id", forumId);
  await adminDb.from("categories").delete().eq("id", categoryId);
  await adminDb.auth.admin.deleteUser(adminUserId).catch(() => {});
});

/** Every <form> in the page whose method is POST. */
function postForms(html: string): string[] {
  const all = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  return all.filter((f) => /<form\b[^>]*method\s*=\s*["']?\s*post/i.test(f));
}

function formName(form: string): string {
  const action = form.match(/action\s*=\s*["']([^"']*)["']/i);
  return action ? action[1] : "(no action)";
}

describe("INVARIANT: every POST form carries a CSRF token", () => {
  // Enumerating, not sampling. A new form on any of these pages is covered
  // automatically; a new PAGE needs adding here, which is the one manual step.
  const authedPages = [
    "/",
    "/search",
    "/profile",
    "/privmsg",
    "/privmsg?mode=post",
    "/groupcp",
    "/memberlist",
    "/admin",
    "/admin/config",
    "/admin/forums",
    "/admin/users",
    "/admin/ranks",
    "/admin/smilies",
    "/admin/words",
    "/admin/bans",
    "/admin/groups",
    "/admin/auth",
    "/admin/themes",
  ];

  let totalFormsSeen = 0;

  it.each(["/login", "/register"])(
    "logged-out page %s",
    async (path) => {
      const res = await app.request(path, { headers: { Origin: "http://localhost" } });
      expect(res.status).toBe(200);
      const forms = postForms(await res.text());
      totalFormsSeen += forms.length;
      for (const form of forms) {
        expect(form, `${path} → form ${formName(form)}`).toContain('name="_csrf"');
      }
    }
  );

  it.each(authedPages)("authenticated page %s", async (path) => {
    const res = await app.request(path, {
      headers: {
        Origin: "http://localhost",
        Cookie: `sb-access-token=${adminAccess}; sb-refresh-token=${adminRefresh}`,
      },
    });
    expect(res.status, `${path} returned ${res.status}`).toBe(200);
    const forms = postForms(await res.text());
    totalFormsSeen += forms.length;
    for (const form of forms) {
      expect(form, `${path} → form ${formName(form)}`).toContain('name="_csrf"');
    }
  });

  it("forum-scoped pages", async () => {
    const paths = [
      `/viewforum/${forumId}`,
      `/viewtopic/${topicId}`, // renders the poll ballot
      `/posting?mode=newtopic&f=${forumId}`,
      `/posting?mode=reply&t=${topicId}`,
      `/modcp?f=${forumId}`,
    ];
    for (const path of paths) {
      const res = await app.request(path, {
        headers: {
          Origin: "http://localhost",
          Cookie: `sb-access-token=${adminAccess}; sb-refresh-token=${adminRefresh}`,
        },
      });
      expect(res.status, `${path} returned ${res.status}`).toBe(200);
      const forms = postForms(await res.text());
      totalFormsSeen += forms.length;
      for (const form of forms) {
        expect(form, `${path} → form ${formName(form)}`).toContain('name="_csrf"');
      }
    }
  });

  it("actually inspected a meaningful number of forms", () => {
    // Guards against the sweep silently passing because the form regex
    // stopped matching or every page started erroring.
    expect(totalFormsSeen).toBeGreaterThan(10);
  });
});

describe("INVARIANT: the poll ballot posts a token", () => {
  it("renders a vote form containing _csrf", async () => {
    const res = await app.request(`/viewtopic/${topicId}`, {
      headers: {
        Origin: "http://localhost",
        Cookie: `sb-access-token=${adminAccess}; sb-refresh-token=${adminRefresh}`,
      },
    });
    const html = await res.text();
    const ballot = postForms(html).find((f) => f.includes('action="/poll"'));
    expect(ballot, "no poll ballot form rendered").toBeDefined();
    expect(ballot).toContain('name="_csrf"');
  });
});

describe("the injected token is the real one, not just a matching string", () => {
  // The injector fires on forms from unmodified phpBB2 templates that have no
  // S_HIDDEN_FIELDS slot (admin/forum_admin_body, admin/ranks_list_body,
  // memberlist_body, viewforum_body). Assert the value it stamps in actually
  // matches the plank-csrf cookie, so it would pass validation — otherwise
  // the sweep above could be satisfied by a well-formed but useless field.
  it("matches the plank-csrf cookie on a template-sourced form", async () => {
    const res = await app.request("/admin/forums", {
      headers: {
        Origin: "http://localhost",
        Cookie: `sb-access-token=${adminAccess}; sb-refresh-token=${adminRefresh}`,
      },
    });
    const html = await res.text();

    const cookieHeader = res.headers
      .getSetCookie()
      .find((x) => x.startsWith("plank-csrf="));
    const cookieToken = cookieHeader
      ? cookieHeader.split(";")[0].split("=")[1]
      : undefined;
    expect(cookieToken, "no plank-csrf cookie issued").toBeTruthy();

    const form = postForms(html).find((f) => f.includes('action="/admin/forums"'));
    expect(form, "admin forums form not rendered").toBeDefined();

    const injected = form!.match(/name="_csrf"\s+value="([^"]+)"/);
    expect(injected, "no _csrf value in the injected field").not.toBeNull();
    expect(injected![1]).toBe(cookieToken);
  });

  it("leaves a form that already has a token alone (no duplicate field)", async () => {
    const res = await app.request("/search", {
      headers: {
        Origin: "http://localhost",
        Cookie: `sb-access-token=${adminAccess}; sb-refresh-token=${adminRefresh}`,
      },
    });
    const form = postForms(await res.text()).find((f) =>
      f.includes('action="/search"')
    );
    expect(form).toBeDefined();
    const count = (form!.match(/name="_csrf"/g) ?? []).length;
    expect(count).toBe(1);
  });
});

describe("link-triggered mutations require their query token", () => {
  // These mutate on GET, which the token middleware treats as safe and never
  // checks, so they validate the token carried in their own URL. Asserted
  // here rather than in the feature suites because vitest.config sets
  // SKIP_CSRF=1 globally — only this file runs the real middleware.
  it("/markread refuses a request with no token", async () => {
    const res = await app.request("/markread", {
      headers: {
        Origin: "http://localhost",
        Cookie: `sb-access-token=${adminAccess}; sb-refresh-token=${adminRefresh}`,
      },
    });
    expect(res.status).toBe(403);
  });

  it("/admin/themes/action refuses a request with no token", async () => {
    const res = await app.request("/admin/themes/action?mode=deactivate", {
      headers: {
        Origin: "http://localhost",
        Cookie: `sb-access-token=${adminAccess}; sb-refresh-token=${adminRefresh}`,
      },
    });
    expect(res.status).toBe(403);
  });

  it("/admin/forum-action refuses a request with no token", async () => {
    const res = await app.request("/admin/forum-action?mode=resync", {
      headers: {
        Origin: "http://localhost",
        Cookie: `sb-access-token=${adminAccess}; sb-refresh-token=${adminRefresh}`,
      },
    });
    expect(res.status).toBe(403);
  });
});

describe("INVARIANT: user-controlled URLs go through the scheme allowlist", () => {
  // Static check. escapeHtml in an href is not sufficient — it stops
  // attribute breakout but not a `javascript:` scheme — so any href/src built
  // from a user-writable profile column must call safeExternalUrl.
  const USER_URL_COLUMNS = ["user_website", "user_avatar", "user_from"];

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      return full.endsWith(".ts") ? [full] : [];
    });
  }

  it("no href/src interpolates a user URL column without safeExternalUrl", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(join(import.meta.dirname, "..", "..", "src"))) {
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        const isUrlAttr = /(?:href|src)\s*=\s*["']\$\{/.test(line);
        if (!isUrlAttr) return;
        const usesUserColumn = USER_URL_COLUMNS.some((c) => line.includes(c));
        if (!usesUserColumn) return;
        if (line.includes("safeExternalUrl")) return;
        offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }

    expect(offenders, `unguarded user URL in an attribute:\n${offenders.join("\n")}`)
      .toEqual([]);
  });
});
