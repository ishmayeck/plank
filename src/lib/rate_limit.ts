import type { Context } from "hono";
import { getSupabaseAdmin } from "../db/client.js";

/**
 * Rate limiting (Chunk 20).
 *
 * Backed by the `check_rate_limit` Postgres RPC (see
 * supabase/migrations/20260531000001_rate_limits.sql) rather than an
 * in-process map: the deployment target is Supabase Edge Functions — many
 * short-lived isolates with no shared memory — so the database is the only
 * store every instance agrees on, and it survives restarts. The RPC is a
 * single atomic fixed-window increment-and-check, so we never read-then-write
 * from JS (the same rule the atomic_counters migration established).
 *
 * Tests bypass via SKIP_RATE_LIMIT=1 (set in vitest.config.ts), mirroring
 * SKIP_CSRF. The dedicated coverage in test/security/rate_limit.test.ts
 * clears the flag to exercise real throttling.
 */

export interface RateLimitRule {
  /** Fixed-window length in seconds. */
  windowSeconds: number;
  /** Max hits allowed per key per window. */
  limit: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Hits recorded in the current window (including this one). */
  count: number;
  /** Seconds until the current window resets (for Retry-After / UI copy). */
  retryAfter: number;
}

/** Named rules, kept here so limits are documented in one place. */
export const RATE_LIMITS = {
  // Per IP. Generous enough for a human fat-fingering a password; tight
  // enough to blunt single-IP brute force / credential stuffing.
  login: { windowSeconds: 600, limit: 20 } as RateLimitRule,
  // Per IP. Account creation is rare; this stops signup floods.
  register: { windowSeconds: 3600, limit: 10 } as RateLimitRule,
  // Per user. Comfortable for real posting; stops flooding.
  posting: { windowSeconds: 300, limit: 20 } as RateLimitRule,
} as const;

/**
 * Best-effort client IP. Behind Supabase Edge / Cloudflare the real client
 * is the first hop of X-Forwarded-For; fall back to other proxy headers and
 * finally a constant so a missing header buckets together rather than
 * throwing. Not spoof-proof — a determined attacker can forge XFF — but
 * adequate for abuse mitigation on a hobby forum.
 */
export function clientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-real-ip") ??
    "unknown"
  );
}

/**
 * Register one hit against `key` and report whether it's within `rule`.
 *
 * Fails OPEN: if the limiter RPC errors (DB hiccup), we allow the request
 * rather than lock every user out. A broken limiter should degrade to "no
 * limiting", never to "deny all".
 */
export async function checkRateLimit(
  key: string,
  rule: RateLimitRule
): Promise<RateLimitResult> {
  if (process.env.SKIP_RATE_LIMIT === "1") {
    return { allowed: true, count: 0, retryAfter: 0 };
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db.rpc("check_rate_limit", {
    p_key: key,
    p_window_seconds: rule.windowSeconds,
    p_limit: rule.limit,
  });

  if (error) {
    console.error("[rate_limit] check failed, failing open:", error.message);
    return { allowed: true, count: 0, retryAfter: 0 };
  }

  // The RPC returns a single-row table.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { allowed: true, count: 0, retryAfter: 0 };

  return {
    allowed: row.allowed as boolean,
    count: row.current_count as number,
    retryAfter: row.retry_after as number,
  };
}

/** Human-friendly "try again in N minutes/seconds" for UI copy. */
export function retryAfterText(seconds: number): string {
  if (seconds >= 60) {
    const mins = Math.ceil(seconds / 60);
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }
  const s = Math.max(1, seconds);
  return `${s} second${s === 1 ? "" : "s"}`;
}
