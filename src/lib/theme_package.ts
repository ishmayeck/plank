import { unzipSync } from "fflate";
import { compile, serializeAst } from "../template/engine.js";

/**
 * Theme package ingestion (Chunk 23: drop-in themes).
 *
 * Takes an uploaded theme `.zip`, hardens + unzips it, compiles every `.tpl`
 * to an AST, and returns a content-addressed package ready to store. The
 * unzip is the ONLY place untrusted bytes touch the system, so it's the part
 * that's hardened (zip-slip, zip-bomb, extension allowlist). Because `.tpl`
 * files compile to inert AST data (no executable code — phpBB2's template
 * language has no expressions), a malicious template can't execute; the worst
 * a bad upload can do is render odd HTML, which the escape-by-default engine
 * still neutralizes.
 *
 * Pure + runtime-agnostic: fflate is pure JS, and the hash uses Web Crypto
 * (`crypto.subtle`), available on Node 20+, Deno, and Workers. No `node:*`.
 * This runs as an off-request job (admin upload), so async hashing is fine.
 */

export interface ThemePackageOptions {
  /** Max number of entries in the archive. */
  maxEntries?: number;
  /** Max total uncompressed bytes across all entries. */
  maxTotalBytes?: number;
  /** Max uncompressed bytes for any single entry. */
  maxEntryBytes?: number;
}

const DEFAULTS: Required<ThemePackageOptions> = {
  maxEntries: 2000,
  maxTotalBytes: 50 * 1024 * 1024, // 50 MiB
  maxEntryBytes: 10 * 1024 * 1024, // 10 MiB
};

/**
 * Files we accept out of an uploaded theme. Templates compile to AST;
 * css/images are served as static assets. Deliberately excludes `.js` and
 * anything executable server-side — the roadmap's "allowlist .tpl/.css/
 * images" rule. `.cfg` is phpBB2 theme metadata (colors), harmless.
 */
const ALLOWED_EXT = new Set([
  ".tpl",
  ".css",
  ".cfg",
  ".gif",
  ".jpg",
  ".jpeg",
  ".png",
]);

export interface ThemePackage {
  /** SHA-256 of the raw zip bytes, hex. The content-addressed cache key. */
  hash: string;
  /** template name (relative path) -> serialized AST JSON. */
  templates: Record<string, string>;
  /** Non-template asset paths kept from the archive (css, images, cfg). */
  assetNames: string[];
  /** Raw asset bytes by name, for the caller to upload to Storage. */
  assets: Record<string, Uint8Array>;
}

export class ThemePackageError extends Error {}

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

/**
 * Reject path-traversal / absolute entry names (zip-slip). An archive entry
 * must be a plain relative path that stays within the extraction root.
 */
function isSafeEntryName(name: string): boolean {
  if (name === "" || name.endsWith("/")) return false; // dirs handled implicitly
  if (name.startsWith("/") || name.startsWith("\\")) return false; // absolute
  if (/^[a-zA-Z]:/.test(name)) return false; // windows drive
  if (name.includes("\\")) return false; // backslashes — normalize away
  // No `..` segment anywhere in the path.
  return !name.split("/").some((seg) => seg === "..");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Ingest a theme zip into a content-addressed, compiled package.
 * Throws ThemePackageError on any hardening violation.
 */
export async function ingestThemeZip(
  zipBytes: Uint8Array,
  options: ThemePackageOptions = {}
): Promise<ThemePackage> {
  const opts = { ...DEFAULTS, ...options };

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch (e) {
    throw new ThemePackageError(
      `Not a valid zip archive: ${(e as Error).message}`
    );
  }

  const names = Object.keys(entries);
  if (names.length > opts.maxEntries) {
    throw new ThemePackageError(
      `Too many entries: ${names.length} > ${opts.maxEntries}`
    );
  }

  const templates: Record<string, string> = {};
  const assets: Record<string, Uint8Array> = {};
  const assetNames: string[] = [];
  let totalBytes = 0;

  for (const name of names) {
    const data = entries[name];
    // fflate yields directory markers as empty entries ending in "/".
    if (name.endsWith("/")) continue;

    if (!isSafeEntryName(name)) {
      throw new ThemePackageError(`Unsafe entry path (zip-slip?): "${name}"`);
    }

    const e = ext(name);
    if (!ALLOWED_EXT.has(e)) {
      // Skip disallowed files silently rather than failing the whole upload —
      // themes often ship stray files (index.htm, .DS_Store, README). We just
      // don't keep them. (Executable types are simply never in the allowlist.)
      continue;
    }

    if (data.length > opts.maxEntryBytes) {
      throw new ThemePackageError(
        `Entry too large (zip-bomb?): "${name}" is ${data.length} bytes`
      );
    }
    totalBytes += data.length;
    if (totalBytes > opts.maxTotalBytes) {
      throw new ThemePackageError(
        `Archive too large (zip-bomb?): exceeds ${opts.maxTotalBytes} bytes uncompressed`
      );
    }

    if (e === ".tpl") {
      const text = new TextDecoder("utf-8").decode(data);
      templates[name] = serializeAst(compile(text));
    } else {
      assets[name] = data;
      assetNames.push(name);
    }
  }

  if (Object.keys(templates).length === 0) {
    throw new ThemePackageError(
      "Archive contains no .tpl templates — not a theme?"
    );
  }

  const hash = await sha256Hex(zipBytes);
  assetNames.sort();

  return { hash, templates, assetNames, assets };
}
