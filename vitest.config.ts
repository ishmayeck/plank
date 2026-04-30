import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    env: {
      // Test fixtures POST without going through the GET-then-token dance.
      // CSRF coverage lives in test/security/csrf.test.ts which clears this.
      SKIP_CSRF: "1",
    },
  },
});
