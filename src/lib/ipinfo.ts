import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * IP intelligence for the mod tools (Chunk 18).
 *
 * The goal from the roadmap is to tell a moderator whether an address looks
 * like a person's home connection or like a datacenter — the signal that
 * separates "a new member" from "a VPN exit or a bot". Explicitly NOT by
 * calling an external API per request: that would leak every poster's IP to a
 * third party, add a network round trip to a mod page, and stop working the
 * day the free tier changes.
 *
 * Two tiers, and the first works with no setup at all:
 *
 *   1. **Structural classification** (this file, pure). Special-purpose ranges
 *      are defined by RFC, not by a database, so private/CGNAT/loopback and
 *      friends can be identified from the address alone. This is the tier that
 *      catches misconfiguration — a board logging 10.x for every post is
 *      recording its own proxy, not its visitors.
 *
 *   2. **Known-network lookup** (ip_ranges table). Cloud and hosting providers
 *      publish their own prefix lists; a loader ingests them offline and
 *      Postgres answers containment queries with a GiST index. Empty by
 *      default, so the feature degrades to tier 1 rather than breaking.
 */

export type IpKind =
  | "invalid"
  | "loopback"
  | "private"
  | "cgnat"
  | "link-local"
  | "documentation"
  | "reserved"
  | "public";

export interface IpClassification {
  kind: IpKind;
  /** Short human label for the mod view. */
  label: string;
  /** True when this address can't have come from the public internet. */
  routable: boolean;
  /** Why a moderator should care, when there's something to say. */
  note?: string;
}

// ── IPv4 ────────────────────────────────────────────────────────────────

interface V4Range {
  base: number;
  bits: number;
  kind: IpKind;
  label: string;
  note?: string;
}

function v4ToInt(parts: number[]): number {
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    // Only plain decimal octets with no leading zeros. "010.1.1.1" is octal
    // to some resolvers and decimal to others, so refusing it beats picking
    // an interpretation and being wrong half the time.
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    nums.push(n);
  }
  return nums;
}

function v4(cidr: string, kind: IpKind, label: string, note?: string): V4Range {
  const [addr, bitsStr] = cidr.split("/");
  const parts = parseIpv4(addr!)!;
  return { base: v4ToInt(parts), bits: Number(bitsStr), kind, label, note };
}

/** Special-purpose IPv4 blocks, per IANA's registry. Most specific first. */
const V4_SPECIAL: V4Range[] = [
  v4("127.0.0.0/8", "loopback", "Loopback",
     "This is the server talking to itself — the real client address is not being recorded."),
  v4("10.0.0.0/8", "private", "Private network",
     "An internal address. If you are seeing this for real visitors, the proxy in front of Plank is not forwarding the client IP."),
  v4("172.16.0.0/12", "private", "Private network",
     "An internal address. If you are seeing this for real visitors, the proxy in front of Plank is not forwarding the client IP."),
  v4("192.168.0.0/16", "private", "Private network",
     "An internal address. If you are seeing this for real visitors, the proxy in front of Plank is not forwarding the client IP."),
  v4("100.64.0.0/10", "cgnat", "Carrier-grade NAT",
     "Shared by many subscribers of one ISP (common on mobile). Treat matches between accounts as weak evidence."),
  v4("169.254.0.0/16", "link-local", "Link-local"),
  v4("192.0.2.0/24", "documentation", "Documentation range"),
  v4("198.51.100.0/24", "documentation", "Documentation range"),
  v4("203.0.113.0/24", "documentation", "Documentation range"),
  v4("0.0.0.0/8", "reserved", "Unspecified"),
  v4("224.0.0.0/4", "reserved", "Multicast"),
  v4("240.0.0.0/4", "reserved", "Reserved"),
];

function inV4Range(value: number, range: V4Range): boolean {
  if (range.bits === 0) return true;
  const mask = range.bits === 32 ? 0xffffffff : (~0 << (32 - range.bits)) >>> 0;
  return (value & mask) >>> 0 === (range.base & mask) >>> 0;
}

// ── IPv6 ────────────────────────────────────────────────────────────────

/** Expand to 8 groups so prefix comparison is a plain string compare. */
function parseIpv6(ip: string): string[] | null {
  const zoneless = ip.split("%")[0]!;
  if (!/^[0-9a-fA-F:.]+$/.test(zoneless) || !zoneless.includes(":")) return null;

  const doubleColons = zoneless.split("::").length - 1;
  if (doubleColons > 1) return null;

  const [head, tail = ""] = zoneless.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];

  // A trailing IPv4 literal (::ffff:1.2.3.4) becomes two groups.
  const expandTrailingV4 = (groups: string[]): string[] | null => {
    if (groups.length === 0) return groups;
    const last = groups[groups.length - 1]!;
    if (!last.includes(".")) return groups;
    const v4parts = parseIpv4(last);
    if (!v4parts) return null;
    const hi = ((v4parts[0]! << 8) | v4parts[1]!).toString(16);
    const lo = ((v4parts[2]! << 8) | v4parts[3]!).toString(16);
    return [...groups.slice(0, -1), hi, lo];
  };

  const h = expandTrailingV4(headGroups);
  const t = expandTrailingV4(tailGroups);
  if (!h || !t) return null;

  const missing = 8 - (h.length + t.length);
  if (doubleColons === 0) {
    if (h.length !== 8 || t.length !== 0) return null;
  } else if (missing < 1) {
    return null;
  }

  const groups = doubleColons === 0 ? h : [...h, ...Array(missing).fill("0"), ...t];
  const out: string[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16).toString(16).padStart(4, "0"));
  }
  return out.length === 8 ? out : null;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Classify an address from its structure alone. No I/O, no data files —
 * these ranges are fixed by RFC.
 */
export function classifyIp(raw: string | null | undefined): IpClassification {
  const ip = (raw ?? "").trim();
  if (!ip) {
    return { kind: "invalid", label: "Not recorded", routable: false };
  }

  const v4parts = parseIpv4(ip);
  if (v4parts) {
    const value = v4ToInt(v4parts);
    for (const range of V4_SPECIAL) {
      if (inV4Range(value, range)) {
        return {
          kind: range.kind,
          label: range.label,
          routable: false,
          note: range.note,
        };
      }
    }
    return { kind: "public", label: "Public address", routable: true };
  }

  const v6 = parseIpv6(ip);
  if (v6) {
    const joined = v6.join(":");
    const first = parseInt(v6[0]!, 16);

    if (joined === "0000:0000:0000:0000:0000:0000:0000:0001") {
      return {
        kind: "loopback",
        label: "Loopback",
        routable: false,
        note: "This is the server talking to itself — the real client address is not being recorded.",
      };
    }
    // ::ffff:0:0/96 — an IPv4 address wearing an IPv6 coat.
    if (v6.slice(0, 5).every((g) => g === "0000") && v6[5] === "ffff") {
      const a = parseInt(v6[6]!, 16);
      const b = parseInt(v6[7]!, 16);
      const mapped = [a >> 8, a & 0xff, b >> 8, b & 0xff].join(".");
      const inner = classifyIp(mapped);
      return { ...inner, label: `${inner.label} (IPv4-mapped)` };
    }
    if ((first & 0xfe00) === 0xfc00) {
      return { kind: "private", label: "Unique local address", routable: false };
    }
    if ((first & 0xffc0) === 0xfe80) {
      return { kind: "link-local", label: "Link-local", routable: false };
    }
    if (joined.startsWith("2001:0db8:")) {
      return { kind: "documentation", label: "Documentation range", routable: false };
    }
    if (joined === "0000:0000:0000:0000:0000:0000:0000:0000") {
      return { kind: "reserved", label: "Unspecified", routable: false };
    }
    return { kind: "public", label: "Public address", routable: true };
  }

  return { kind: "invalid", label: "Unrecognised address", routable: false };
}

/** A hit from the operator-populated known-networks table. */
export interface KnownNetwork {
  kind: string;
  org: string;
  network: string;
  source: string | null;
}

/**
 * Look the address up in ip_ranges, most-specific prefix wins.
 *
 * Returns null when the table is empty or has no match, which is the normal
 * state — populating it is optional (see scripts/load-ip-ranges.ts).
 */
export async function lookupKnownNetwork(
  db: SupabaseClient,
  ip: string
): Promise<KnownNetwork | null> {
  if (!classifyIp(ip).routable) return null;

  const { data, error } = await db.rpc("lookup_ip_range", { p_ip: ip });
  if (error) {
    // A missing table or a malformed address must not break the mod page.
    console.error("[ipinfo] range lookup failed:", error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row ? (row as KnownNetwork) : null;
}

/** Everything the mod view wants to say about one address. */
export interface IpReport {
  ip: string;
  classification: IpClassification;
  known: KnownNetwork | null;
  /** One-line summary for a cramped template slot. */
  summary: string;
}

export async function describeIp(
  db: SupabaseClient,
  ip: string | null | undefined
): Promise<IpReport> {
  const address = (ip ?? "").trim();
  const classification = classifyIp(address);
  const known = classification.routable
    ? await lookupKnownNetwork(db, address)
    : null;

  let summary: string;
  if (known) {
    summary = `${describeKind(known.kind)} — ${known.org}`;
  } else if (classification.kind === "public") {
    // Absence of a hit is not evidence of a residential connection; say so
    // rather than implying the table is authoritative.
    summary = "Public address, not in any known hosting range";
  } else {
    summary = classification.label;
  }

  return { ip: address, classification, known, summary };
}

function describeKind(kind: string): string {
  switch (kind) {
    case "cloud": return "Cloud provider";
    case "hosting": return "Hosting provider";
    case "vpn": return "VPN provider";
    case "tor": return "Tor exit node";
    case "proxy": return "Public proxy";
    default: return "Known network";
  }
}
