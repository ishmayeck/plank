import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    // All DB-backed suites share ONE local Supabase instance and seed
    // fixed-email users + fixed category/forum rows. Running test files in
    // parallel makes them collide non-deterministically (duplicate-email
    // signups, shared rows mutated mid-test) — the same file passes alone
    // but the suite fails differently every run. Pin execution to a single
    // fork so `npm test` is a trustworthy signal. Pure-logic suites
    // (template engine, escape, bbcode) are unaffected by this; the cost is
    // ~20s serial vs ~6s parallel, well worth determinism.
    fileParallelism: false,
    env: {
      // Test fixtures POST without going through the GET-then-token dance.
      // CSRF coverage lives in test/security/csrf.test.ts which clears this.
      SKIP_CSRF: "1",
    },
  },
});
