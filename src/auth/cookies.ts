import type { CookieOptions } from "hono/utils/cookie";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

/** Sb auth access-token cookie options. 7-day lifetime. */
export const ACCESS_COOKIE_OPTS: CookieOptions = {
  httpOnly: true,
  sameSite: "Lax",
  path: "/",
  maxAge: 7 * DAY,
};

/** Sb auth refresh-token cookie options. 30-day lifetime. */
export const REFRESH_COOKIE_OPTS: CookieOptions = {
  httpOnly: true,
  sameSite: "Lax",
  path: "/",
  maxAge: 30 * DAY,
};

/** Cookie identifying a guest browser, for "who's online". 1-hour lifetime. */
export const GUEST_SID_COOKIE_OPTS: CookieOptions = {
  httpOnly: true,
  sameSite: "Lax",
  path: "/",
  maxAge: HOUR,
};
