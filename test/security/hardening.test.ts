import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";
import { sniffImageFormat } from "../../src/lib/avatar.js";
import { cleanupTestUser } from "../util/users.js";

config({ path: ".env" });

let adminDb: SupabaseClient;
let userId: string;

const USERNAME = "HardeningUser";
const EMAIL = "hardening@plank.local";
const PASSWORD = "hardening-pass-1234";

beforeAll(async () => {
  adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  await cleanupTestUser(adminDb, USERNAME, EMAIL);
  const { data } = await adminDb.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  userId = data.user!.id;
  await adminDb.from("profiles").insert({ id: userId, username: USERNAME });
});

afterAll(async () => {
  await adminDb.auth.admin.deleteUser(userId).catch(() => {});
});

describe("security response headers", () => {
  it("sets the baseline headers on an HTML response", async () => {
    const res = await app.request("/");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("sets a CSP that constrains framing, base, objects and form targets", async () => {
    const csp = (await app.request("/")).headers.get("content-security-policy");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
  });

  it("allows same-origin framing, because the topic review is an iframe", async () => {
    // frame-ancestors 'none' would break /posting_topic_review, which the
    // posting page loads in an iframe.
    const csp = (await app.request("/")).headers.get("content-security-policy");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("frame-ancestors 'none'");
  });
});

describe("session cookies are Secure", () => {
  it("marks auth cookies Secure and HttpOnly on login", async () => {
    const form = new FormData();
    form.append("username", USERNAME);
    form.append("password", PASSWORD);
    const res = await app.request("/login", { method: "POST", body: form });

    const cookies = res.headers.getSetCookie();
    const access = cookies.find((c) => c.startsWith("sb-access-token="));
    const refresh = cookies.find((c) => c.startsWith("sb-refresh-token="));

    expect(access).toBeDefined();
    for (const cookie of [access!, refresh!]) {
      expect(cookie, cookie).toMatch(/;\s*Secure/i);
      expect(cookie, cookie).toMatch(/;\s*HttpOnly/i);
    }
  });
});

describe("avatar magic-number sniffing", () => {
  // image-size dispatches on the real bytes and has unfixed infinite-loop
  // advisories for ICNS/JXL/HEIF, so nothing else may reach it.
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

  it("accepts the three formats we support", () => {
    expect(sniffImageFormat(gif)).toBe("gif");
    expect(sniffImageFormat(png)).toBe("png");
    expect(sniffImageFormat(jpeg)).toBe("jpeg");
  });

  it("rejects an ICNS header even though it is a real image format", () => {
    // "icns" — one of the vulnerable parsers.
    const icns = new Uint8Array([0x69, 0x63, 0x6e, 0x73, 0, 0, 0, 8]);
    expect(sniffImageFormat(icns)).toBeNull();
  });

  it("rejects arbitrary bytes and short input", () => {
    expect(sniffImageFormat(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    expect(sniffImageFormat(new Uint8Array([]))).toBeNull();
    expect(sniffImageFormat(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});
