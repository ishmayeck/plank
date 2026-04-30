import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Force the real CSRF middleware to engage for this file. Other test
// files inherit SKIP_CSRF=1 from vitest.config.ts; here we want to
// verify that the protection actually rejects forged requests.
process.env.SKIP_CSRF = "0";

// Import the app *after* clearing the env var so the conditional
// app.use registers the middlewares.
const { default: app } = await import("../../src/app.js");

config({ path: ".env" });

let adminDb: SupabaseClient;
let userId: string;
let access: string;
let refresh: string;
const username = `CsrfTestUser_${Math.random().toString(36).slice(2, 8)}`;
const password = "csrftest-pass-1234";
const email = `csrf-${Math.random().toString(36).slice(2, 8)}@plank.local`;

beforeAll(async () => {
  adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data } = await adminDb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  userId = data.user!.id;
  await adminDb.from("profiles").insert({ id: userId, username });

  // Log in via cross-origin-blocked semantics requires Origin header
  const loginForm = new FormData();
  loginForm.append("username", username);
  loginForm.append("password", password);
  // First fetch / to get the csrf cookie
  const seedRes = await app.request("/", {
    headers: { Origin: "http://localhost" },
  });
  const csrfCookie = seedRes.headers.getSetCookie().find((c) => c.startsWith("plank-csrf="));
  const csrfToken = csrfCookie!.split(";")[0].split("=")[1];
  loginForm.append("_csrf", csrfToken);

  const loginRes = await app.request("/login", {
    method: "POST",
    body: loginForm,
    headers: {
      Origin: "http://localhost",
      Cookie: `plank-csrf=${csrfToken}`,
    },
  });
  if (loginRes.status !== 302) {
    throw new Error(`Login failed with status ${loginRes.status}: ${await loginRes.text()}`);
  }
  const cookies = loginRes.headers.getSetCookie();
  access = cookies
    .find((c) => c.startsWith("sb-access-token="))!
    .substring("sb-access-token=".length)
    .split(";")[0];
  refresh = cookies
    .find((c) => c.startsWith("sb-refresh-token="))!
    .substring("sb-refresh-token=".length)
    .split(";")[0];
});

afterAll(async () => {
  await adminDb.auth.admin.deleteUser(userId);
});

describe("CSRF protection", () => {
  it("rejects a POST with no Origin header (Hono csrf middleware)", async () => {
    const fd = new FormData();
    fd.append("username", username);
    fd.append("password", password);
    const res = await app.request("/login", {
      method: "POST",
      body: fd,
    });
    expect(res.status).toBe(403);
  });

  it("rejects a POST with a foreign Origin header", async () => {
    const fd = new FormData();
    fd.append("username", username);
    fd.append("password", password);
    const res = await app.request("/login", {
      method: "POST",
      body: fd,
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects a POST with same-origin but no token", async () => {
    const fd = new FormData();
    fd.append("username", username);
    fd.append("password", password);
    const res = await app.request("/login", {
      method: "POST",
      body: fd,
      headers: { Origin: "http://localhost" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects a POST whose body token does not match the cookie", async () => {
    const seedRes = await app.request("/", {
      headers: { Origin: "http://localhost" },
    });
    const csrfCookie = seedRes.headers.getSetCookie().find((c) => c.startsWith("plank-csrf="));
    const realToken = csrfCookie!.split(";")[0].split("=")[1];

    const fd = new FormData();
    fd.append("username", username);
    fd.append("password", password);
    fd.append("_csrf", "0".repeat(realToken.length));
    const res = await app.request("/login", {
      method: "POST",
      body: fd,
      headers: {
        Origin: "http://localhost",
        Cookie: `plank-csrf=${realToken}`,
      },
    });
    expect(res.status).toBe(403);
  });

  it("accepts a POST with matching cookie + body token", async () => {
    // We already verified the login flow worked in beforeAll, so just
    // re-run a privileged action: GET /privmsg should 200 once logged in.
    const res = await app.request("/privmsg", {
      headers: {
        Cookie: `sb-access-token=${access}; sb-refresh-token=${refresh}`,
      },
    });
    expect(res.status).toBe(200);
  });
});
