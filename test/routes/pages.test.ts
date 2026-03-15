import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import app from "../../src/app.js";

config({ path: ".env" });

describe("Pages", () => {
  describe("FAQ", () => {
    it("renders FAQ page", async () => {
      const res = await app.request("/faq");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Frequently Asked Questions");
      expect(html).toContain("Login and Registration Issues");
      expect(html).toContain("How do I post a topic?");
    });

    it("contains BBCode FAQ entry", async () => {
      const res = await app.request("/faq");
      const html = await res.text();
      expect(html).toContain("What is BBCode?");
      expect(html).toContain("[b]bold[/b]");
    });
  });

  describe("Who is Online", () => {
    it("renders viewonline page", async () => {
      const res = await app.request("/viewonline");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Registered Users Online");
      expect(html).toContain("Guest Users Online");
    });
  });

  describe("Mark Read", () => {
    it("redirects to index", async () => {
      const res = await app.request("/markread");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
    });
  });
});
