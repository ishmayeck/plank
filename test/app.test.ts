import { describe, it, expect } from "vitest";
import app from "../src/index.js";

describe("Hono app", () => {
  it("serves the index page with Solaris theme", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Plank Forum :: Index");
    expect(html).toContain("Solaris.css");
    expect(html).toContain("General Discussion");
    expect(html).toContain("</html>");
  });
});
