import type { CookieOptions } from "hono/utils/cookie";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

/**
 * Mark cookies Secure so they are never sent over plaintext HTTP.
 *
 * Without this, a single http:// request to the site — a typed URL, an old
 * bookmark, a downgrade attempt — hands over the session tokens in the clear,
 * and SameSite=Lax does nothing to stop it because a top-level navigation is
 * exactly what Lax allows. Browsers treat http://localhost as a trustworthy
 * origin, so this is safe for local dev too; PLANK_COOKIE_INSECURE=1 exists
 * only for a non-localhost plaintext dev host.
 *
 * Note the admin panel's "Cookie secure" board setting (config.cookie_secure)
 * is phpBB2 furniture — it is stored and rendered but has never been applied
 * to a real cookie. This constant is what actually governs.
 */
const SECURE = process.env.PLANK_COOKIE_INSECURE !== "1";

/** Sb auth access-token cookie options. 7-day lifetime. */
export const ACCESS_COOKIE_OPTS: CookieOptions = {
  httpOnly: true,
  secure: SECURE,
  sameSite: "Lax",
  path: "/",
  maxAge: 7 * DAY,
};

/** Sb auth refresh-token cookie options. 30-day lifetime. */
export const REFRESH_COOKIE_OPTS: CookieOptions = {
  httpOnly: true,
  secure: SECURE,
  sameSite: "Lax",
  path: "/",
  maxAge: 30 * DAY,
};

/** Cookie identifying a guest browser, for "who's online". 1-hour lifetime. */
export const GUEST_SID_COOKIE_OPTS: CookieOptions = {
  httpOnly: true,
  secure: SECURE,
  sameSite: "Lax",
  path: "/",
  maxAge: HOUR,
};

/** Options for the CSRF synchroniser-token cookie. 30-day lifetime. */
export const CSRF_COOKIE_OPTS: CookieOptions = {
  httpOnly: true,
  secure: SECURE,
  sameSite: "Lax",
  path: "/",
  maxAge: 30 * DAY,
};
