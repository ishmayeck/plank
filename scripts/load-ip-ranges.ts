/**
 * Populate the ip_ranges table from the prefix lists cloud providers publish
 * about themselves (Chunk 18 — IP intelligence).
 *
 *   npx tsx scripts/load-ip-ranges.ts            # all sources
 *   npx tsx scripts/load-ip-ranges.ts aws tor    # named sources only
 *   npx tsx scripts/load-ip-ranges.ts --list
 *
 * Run OFFLINE, occasionally. The whole point of the design is that the forum
 * never calls anyone at request time: a moderator viewing an IP hits a local
 * indexed query, not a third-party API that would learn every poster's
 * address. Re-run this when you want fresher data; nothing breaks if you
 * never do, and nothing breaks if you never run it at all — the mod view
 * falls back to structural classification.
 *
 * Only sources that publish machine-readable ranges under their own name are
 * included. Commercial "VPN detection" lists are deliberately absent: they are
 * licensed data, they are wrong often enough to matter, and a wrong "VPN"
 * label next to a member's name is worse than no label.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env" });

interface Source {
  key: string;
  org: string;
  kind: "cloud" | "hosting" | "vpn" | "tor" | "proxy";
  url: string;
  /** Pull CIDR strings out of whatever shape this source publishes. */
  parse: (body: string) => string[];
}

/** One prefix per line, possibly with comments. */
function parseLines(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

const SOURCES: Source[] = [
  {
    key: "aws",
    org: "Amazon AWS",
    kind: "cloud",
    url: "https://ip-ranges.amazonaws.com/ip-ranges.json",
    parse: (body) => {
      const doc = JSON.parse(body);
      return [
        ...(doc.prefixes ?? []).map((p: any) => p.ip_prefix),
        ...(doc.ipv6_prefixes ?? []).map((p: any) => p.ipv6_prefix),
      ].filter(Boolean);
    },
  },
  {
    key: "gcp",
    org: "Google Cloud",
    kind: "cloud",
    url: "https://www.gstatic.com/ipranges/cloud.json",
    parse: (body) => {
      const doc = JSON.parse(body);
      return (doc.prefixes ?? [])
        .map((p: any) => p.ipv4Prefix ?? p.ipv6Prefix)
        .filter(Boolean);
    },
  },
  {
    key: "cloudflare",
    org: "Cloudflare",
    kind: "cloud",
    url: "https://www.cloudflare.com/ips-v4",
    parse: parseLines,
  },
  {
    key: "cloudflare6",
    org: "Cloudflare",
    kind: "cloud",
    url: "https://www.cloudflare.com/ips-v6",
    parse: parseLines,
  },
  {
    key: "tor",
    org: "Tor exit nodes",
    kind: "tor",
    url: "https://check.torproject.org/torbulkexitlist",
    // Bare addresses; store each as a single-host prefix.
    parse: (body) => parseLines(body).map((ip) => (ip.includes(":") ? `${ip}/128` : `${ip}/32`)),
  },
];

async function loadSource(db: ReturnType<typeof createClient>, source: Source) {
  process.stdout.write(`${source.key.padEnd(12)} fetching… `);
  let body: string;
  try {
    const res = await fetch(source.url, {
      headers: { "user-agent": "plank-ip-ranges-loader" },
    });
    if (!res.ok) {
      console.log(`FAILED (${res.status} ${res.statusText})`);
      return;
    }
    body = await res.text();
  } catch (err) {
    console.log(`FAILED (${err instanceof Error ? err.message : err})`);
    return;
  }

  let networks: string[];
  try {
    networks = source.parse(body);
  } catch (err) {
    console.log(`FAILED to parse (${err instanceof Error ? err.message : err})`);
    return;
  }

  if (networks.length === 0) {
    // A source that silently changed shape would otherwise wipe its own rows.
    console.log("FAILED (no prefixes parsed — has the format changed?)");
    return;
  }

  // Providers list the same prefix more than once — AWS publishes each range
  // once per service and region, so ip-ranges.json repeats 52.94.0.0/16 many
  // times over. Postgres refuses an upsert whose batch touches one row twice
  // ("ON CONFLICT DO UPDATE command cannot affect row a second time"), so the
  // duplicates have to go before we get there, not after.
  const unique = [...new Set(networks)];
  const rows = unique.map((network) => ({
    network,
    kind: source.kind,
    org: source.org,
    source: source.url,
    updated_at: new Date().toISOString(),
  }));

  // Replace this org's rows wholesale: providers withdraw prefixes as well as
  // adding them, and a stale "this is AWS" is a wrong answer, not a missing
  // one. Delete only after a successful parse, so a bad fetch leaves the
  // previous data intact.
  await db.from("ip_ranges").delete().eq("org", source.org).eq("source", source.url);

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const { error } = await db.from("ip_ranges").upsert(batch, {
      onConflict: "network,org",
    });
    if (error) {
      console.log(`FAILED at row ${i} (${error.message})`);
      return;
    }
    inserted += batch.length;
  }

  const dropped = networks.length - unique.length;
  console.log(
    `${inserted} prefixes` + (dropped ? ` (${dropped} duplicates collapsed)` : "")
  );
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list")) {
    console.log("Available sources:\n");
    for (const s of SOURCES) {
      console.log(`  ${s.key.padEnd(12)} ${s.kind.padEnd(8)} ${s.org}`);
    }
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
    process.exit(1);
  }
  const db = createClient(url, key);

  const wanted = args.filter((a) => !a.startsWith("--"));
  const selected = wanted.length
    ? SOURCES.filter((s) => wanted.includes(s.key))
    : SOURCES;

  if (selected.length === 0) {
    console.error(`No matching sources. Try --list.`);
    process.exit(1);
  }

  for (const source of selected) {
    await loadSource(db, source);
  }

  const { count } = await db
    .from("ip_ranges")
    .select("*", { count: "exact", head: true });
  console.log(`\nip_ranges now holds ${count ?? 0} prefixes.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
