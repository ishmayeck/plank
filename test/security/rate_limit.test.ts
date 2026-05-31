import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Engage the real rate limiter for this file. Other suites inherit
// SKIP_RATE_LIMIT=1 from vitest.config.ts; here we clear it (mirrors how
// csrf.test.ts clears SKIP_CSRF) so we exercise actual throttling.
process.env.SKIP_RATE_LIMIT = "0";

// Import app + module *after* clearing the flag.
const { default: app } = await import("../../src/app.js");
const { checkRateLimit, clientIp, retryAfterText } = await import(
  "../../src/lib/rate_limit.js"
);

config({ path: ".env" });

let adminDb: SupabaseClient;

beforeAll(() => {
  adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
});

// Each test uses a unique bucket key so windows never collide across tests.
function freshKey(label: string): string {
  return `test:${label}:${Math.random().toString(36).slice(2)}`;
}

afterAll(async () => {
  await adminDb.from("rate_limits").delete().like("bucket_key", "test:%");
  await adminDb.from("rate_limits").delete().like("bucket_key", "login:ip:rltest-%");
});

describe("rate limiter — core (check_rate_limit RPC)", () => {
  it("allows up to the limit, then blocks", async () => {
    const key = freshKey("basic");
    const rule = { windowSeconds: 60, limit: 3 };

    const r1 = await checkRateLimit(key, rule);
    const r2 = await checkRateLimit(key, rule);
    const r3 = await checkRateLimit(key, rule);
    const r4 = await checkRateLimit(key, rule);

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
    expect(r4.allowed).toBe(false); // 4th over a limit of 3
    expect(r4.count).toBe(4);
    expect(r4.retryAfter).toBeGreaterThan(0);
    expect(r4.retryAfter).toBeLessThanOrEqual(60);
  });

  it("tracks independent keys separately", async () => {
    const a = freshKey("indep-a");
    const b = freshKey("indep-b");
    const rule = { windowSeconds: 60, limit: 1 };

    expect((await checkRateLimit(a, rule)).allowed).toBe(true);
    expect((await checkRateLimit(a, rule)).allowed).toBe(false); // a exhausted
    expect((await checkRateLimit(b, rule)).allowed).toBe(true); // b unaffected
  });

  it("respects SKIP_RATE_LIMIT bypass", async () => {
    process.env.SKIP_RATE_LIMIT = "1";
    try {
      const key = freshKey("bypass");
      const rule = { windowSeconds: 60, limit: 1 };
      // Many calls, all allowed because the limiter is bypassed.
      for (let i = 0; i < 5; i++) {
        expect((await checkRateLimit(key, rule)).allowed).toBe(true);
      }
    } finally {
      process.env.SKIP_RATE_LIMIT = "0";
    }
  });
});

describe("rate limiter — helpers", () => {
  it("clientIp prefers the first X-Forwarded-For hop", () => {
    const c: any = {
      req: { header: (h: string) => (h === "x-forwarded-for" ? "1.2.3.4, 5.6.7.8" : undefined) },
    };
    expect(clientIp(c)).toBe("1.2.3.4");
  });

  it("clientIp falls back to a constant when no header is present", () => {
    const c: any = { req: { header: () => undefined } };
    expect(clientIp(c)).toBe("unknown");
  });

  it("retryAfterText renders minutes and seconds", () => {
    expect(retryAfterText(600)).toBe("10 minutes");
    expect(retryAfterText(60)).toBe("1 minute");
    expect(retryAfterText(30)).toBe("30 seconds");
    expect(retryAfterText(1)).toBe("1 second");
  });
});

describe("rate limiter — login endpoint", () => {
  // RATE_LIMITS.login is 20/window; after 20 attempts from one IP the 21st
  // should be throttled with 429 regardless of credentials.
  it("returns 429 after exceeding the per-IP login limit", async () => {
    const ip = `rltest-${Math.random().toString(36).slice(2)}`;
    const attempt = () =>
      app.request("/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "x-forwarded-for": ip,
          // CSRF is still skipped globally (only SKIP_RATE_LIMIT cleared here).
        },
        body: new URLSearchParams({ username: "nobody", password: "wrong" }),
      });

    // First 20 attempts: not rate limited (they'll be 200 bad-credentials).
    let lastOk = 0;
    for (let i = 0; i < 20; i++) {
      const res = await attempt();
      lastOk = res.status;
    }
    expect(lastOk).toBe(200);

    // 21st: throttled.
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    const html = await blocked.text();
    expect(html).toContain("Too many login attempts");
  });
});
