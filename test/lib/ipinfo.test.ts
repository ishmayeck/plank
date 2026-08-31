import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { classifyIp, describeIp, lookupKnownNetwork } from "../../src/lib/ipinfo.js";

config({ path: ".env" });

describe("structural classification (no data required)", () => {
  const kindOf = (ip: string) => classifyIp(ip).kind;

  it("recognises ordinary public addresses", () => {
    expect(kindOf("8.8.8.8")).toBe("public");
    expect(kindOf("1.1.1.1")).toBe("public");
    expect(kindOf("93.184.216.34")).toBe("public");
    expect(classifyIp("8.8.8.8").routable).toBe(true);
  });

  it("recognises RFC1918 private ranges", () => {
    expect(kindOf("10.0.0.1")).toBe("private");
    expect(kindOf("172.16.0.1")).toBe("private");
    expect(kindOf("172.31.255.254")).toBe("private");
    expect(kindOf("192.168.1.1")).toBe("private");
  });

  it("does not over-claim the 172.16/12 boundary", () => {
    // 172.15 and 172.32 are public; only 172.16-172.31 are private. An
    // off-by-one here would mislabel real visitors as internal.
    expect(kindOf("172.15.255.255")).toBe("public");
    expect(kindOf("172.32.0.0")).toBe("public");
  });

  it("flags carrier-grade NAT separately from private", () => {
    // Worth its own kind: matches between accounts on CGNAT are weak
    // evidence, because a whole mobile network shares the range.
    expect(kindOf("100.64.0.1")).toBe("cgnat");
    expect(kindOf("100.127.255.255")).toBe("cgnat");
    expect(kindOf("100.63.255.255")).toBe("public");
    expect(kindOf("100.128.0.0")).toBe("public");
  });

  it("recognises loopback, link-local, documentation and reserved", () => {
    expect(kindOf("127.0.0.1")).toBe("loopback");
    expect(kindOf("169.254.1.1")).toBe("link-local");
    expect(kindOf("192.0.2.5")).toBe("documentation");
    expect(kindOf("203.0.113.9")).toBe("documentation");
    expect(kindOf("0.0.0.0")).toBe("reserved");
    expect(kindOf("239.1.2.3")).toBe("reserved");
  });

  it("explains why a private address matters to a moderator", () => {
    // The useful reading of 10.x in poster_ip is "your proxy is not
    // forwarding the client address", not "this user is internal".
    expect(classifyIp("10.1.2.3").note).toMatch(/proxy/i);
    expect(classifyIp("127.0.0.1").note).toMatch(/itself/i);
  });

  it("rejects malformed addresses instead of guessing", () => {
    for (const bad of ["", "   ", "not an ip", "1.2.3", "1.2.3.4.5", "256.1.1.1", "1.2.3.-1"]) {
      expect(kindOf(bad), bad).toBe("invalid");
    }
    expect(classifyIp(null).kind).toBe("invalid");
  });

  it("rejects octets with leading zeros, which parse ambiguously", () => {
    // 010.1.1.1 is octal in some resolvers and decimal in others; refusing
    // it is safer than picking an interpretation.
    expect(kindOf("010.1.1.1")).toBe("invalid");
  });

  it("classifies IPv6", () => {
    expect(kindOf("::1")).toBe("loopback");
    expect(kindOf("2001:4860:4860::8888")).toBe("public");
    expect(kindOf("fd00::1")).toBe("private");
    expect(kindOf("fe80::1")).toBe("link-local");
    expect(kindOf("2001:db8::1")).toBe("documentation");
    expect(kindOf("::")).toBe("reserved");
  });

  it("sees through IPv4-mapped IPv6 addresses", () => {
    // ::ffff:10.0.0.1 is a private address wearing an IPv6 coat; treating it
    // as public would defeat the whole classification.
    expect(kindOf("::ffff:10.0.0.1")).toBe("private");
    expect(kindOf("::ffff:8.8.8.8")).toBe("public");
    expect(classifyIp("::ffff:8.8.8.8").label).toMatch(/IPv4-mapped/);
  });

  it("rejects malformed IPv6", () => {
    expect(kindOf("2001::db8::1")).toBe("invalid"); // two "::"
    expect(kindOf("12345::1")).toBe("invalid");
    expect(kindOf("gggg::1")).toBe("invalid");
  });
});

describe("known-network lookup", () => {
  let adminDb: SupabaseClient;
  const ORG = "IpInfoTestProvider";

  beforeAll(async () => {
    adminDb = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    await adminDb.from("ip_ranges").delete().eq("org", ORG);
    await adminDb.from("ip_ranges").delete().eq("org", `${ORG} (specific)`);
    await adminDb.from("ip_ranges").insert([
      { network: "203.0.55.0/24", kind: "cloud", org: ORG, source: "test" },
      // An overlapping, narrower prefix — providers really do publish these.
      { network: "203.0.55.128/25", kind: "vpn", org: `${ORG} (specific)`, source: "test" },
    ]);
  });

  afterAll(async () => {
    await adminDb.from("ip_ranges").delete().like("org", `${ORG}%`);
  });

  it("finds an address inside a registered range", async () => {
    const hit = await lookupKnownNetwork(adminDb, "203.0.55.10");
    expect(hit?.org).toBe(ORG);
    expect(hit?.kind).toBe("cloud");
  });

  it("prefers the most specific overlapping prefix", async () => {
    // The /25 is the more useful attribution; returning the /24 would lose
    // the fact that this half of the range is a VPN.
    const hit = await lookupKnownNetwork(adminDb, "203.0.55.200");
    expect(hit?.org).toBe(`${ORG} (specific)`);
    expect(hit?.kind).toBe("vpn");
  });

  it("returns null for an address in no registered range", async () => {
    expect(await lookupKnownNetwork(adminDb, "8.8.8.8")).toBeNull();
  });

  it("does not query for non-routable addresses", async () => {
    expect(await lookupKnownNetwork(adminDb, "192.168.1.1")).toBeNull();
  });

  it("survives a malformed address rather than erroring", async () => {
    expect(await lookupKnownNetwork(adminDb, "not-an-ip")).toBeNull();
  });

  it("summarises a known range for the mod view", async () => {
    const report = await describeIp(adminDb, "203.0.55.10");
    expect(report.summary).toContain("Cloud provider");
    expect(report.summary).toContain(ORG);
  });

  it("does not imply an unlisted address is residential", async () => {
    // An empty or partial range table must not be presented as authoritative.
    const report = await describeIp(adminDb, "8.8.8.8");
    expect(report.known).toBeNull();
    expect(report.summary).toMatch(/not in any known hosting range/i);
  });

  it("reports the structural classification when there's no lookup to do", async () => {
    const report = await describeIp(adminDb, "10.0.0.5");
    expect(report.summary).toBe("Private network");
    expect(report.classification.note).toMatch(/proxy/i);
  });
});
