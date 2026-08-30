/**
 * URL scheme safety for user-supplied links.
 *
 * escapeHtml is not enough on its own for an href. It escapes `& < > " '`,
 * which stops an attacker breaking OUT of the attribute — but a scheme needs
 * none of those characters. `javascript:alert(document.cookie)` survives
 * escaping byte-for-byte, so a profile "website" field rendered as
 * `<a href="${escapeHtml(value)}">` is stored XSS that fires on click.
 *
 * bbcode.ts already got this right by only ever matching `(?:https?|ftp)://`
 * when it builds a link. This module is the same rule, extracted so the
 * non-BBCode render paths (profile, memberlist) share one implementation
 * instead of each inventing their own.
 */

/** Schemes we will emit into an href/src. Allowlist, never a denylist. */
const SAFE_SCHEME = /^(?:https?|ftp):\/\//i;

/**
 * Browsers strip leading whitespace and C0 control characters before parsing
 * a URL's scheme, so `\tjava\nscript:x` is a live javascript: URL to them.
 * Strip the same set before testing, and reject anything still containing a
 * control character.
 */
function normalize(url: string): string {
  // C0 controls (tab, newline, NUL...), space, and DEL — the characters
  // browsers discard before they parse the scheme.
  return url.replace(/[\u0000-\u0020\u007F]/g, "");
}

/** True if this URL is safe to place in an href/src attribute. */
export function isSafeHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return SAFE_SCHEME.test(normalize(url));
}

/**
 * The URL if it's safe to link to, otherwise null. Callers MUST handle null
 * by rendering the value as inert text rather than as a link — never by
 * falling back to the raw value.
 */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  return isSafeHttpUrl(trimmed) ? trimmed : null;
}

/**
 * Accept what a user is likely to type in a "website" field. A bare
 * `example.com` gets an https:// prefix; anything carrying its own scheme
 * must carry a safe one.
 *
 * Returns null when the input can't be made safe, so the caller can show a
 * validation error instead of silently storing something unlinkable.
 */
export function normalizeWebsiteInput(input: string | null | undefined): string | null {
  const value = normalize((input ?? "").trim());
  if (!value) return "";

  if (SAFE_SCHEME.test(value)) return value;

  // A colon before the first slash means it declared some other scheme
  // (javascript:, data:, vbscript:, mailto:…). Don't try to rescue it.
  const firstSlash = value.indexOf("/");
  const firstColon = value.indexOf(":");
  if (firstColon !== -1 && (firstSlash === -1 || firstColon < firstSlash)) {
    return null;
  }

  // Schemeless, and can't be hiding a scheme — treat as a bare host/path.
  return `https://${value}`;
}
