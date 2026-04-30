import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { getCookie, setCookie } from "hono/cookie";
import { markup, type MarkupString } from "./markup.js";
import { escapeHtml } from "./escape.js";

const CSRF_COOKIE = "plank-csrf";
const CSRF_FIELD = "_csrf";

/**
 * Get the per-session CSRF token from the cookie, creating a fresh one
 * (and setting the cookie) if absent. The token is stable for the
 * lifetime of the cookie.
 *
 * The cookie is httpOnly — JS can't read it. The server reads it from
 * the request and embeds the value into form fields via csrfField().
 */
export function getCsrfToken(c: Context): string {
  let token = getCookie(c, CSRF_COOKIE);
  if (!token) {
    token = generateToken();
    setCookie(c, CSRF_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  }
  return token;
}

/** A `<input type="hidden" name="_csrf" value="...">` for forms. */
export function csrfField(token: string): MarkupString {
  return markup(
    `<input type="hidden" name="${CSRF_FIELD}" value="${escapeHtml(token)}" />`
  );
}

/**
 * Build the contents of a form's `S_HIDDEN_FIELDS` template variable,
 * always prefixed with the CSRF token. Pass any additional hidden
 * inputs as raw HTML strings (callers must escape values themselves).
 */
export function formHiddenFields(c: Context, ...extraInputsHtml: string[]): MarkupString {
  const token = getCsrfToken(c);
  return markup(csrfField(token).html + extraInputsHtml.join(""));
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Single middleware that:
 *  - On safe methods (GET/HEAD/OPTIONS): seeds the plank-csrf cookie
 *    if absent, so subsequent forms can embed the token.
 *  - On state-changing methods: validates that the form's _csrf field
 *    matches the cookie. Returns 403 with a short message on mismatch.
 *
 * Hono's built-in csrf() middleware (Origin/Referer check) sits in
 * front of this and provides defense in depth.
 */
export const csrfTokenMiddleware: MiddlewareHandler = createMiddleware(
  async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) {
      // Seed the cookie so forms rendered on this response can embed it.
      getCsrfToken(c);
      return next();
    }
    const cookieToken = getCookie(c, CSRF_COOKIE);
    if (!cookieToken) {
      return c.text("CSRF token missing", 403);
    }
    let bodyToken: string | undefined;
    const contentType = c.req.header("content-type") ?? "";
    if (
      contentType.startsWith("application/x-www-form-urlencoded") ||
      contentType.startsWith("multipart/form-data")
    ) {
      // parseBody caches its result on the request, so subsequent calls
      // by the route handler reuse the same object.
      const body = await c.req.parseBody();
      const value = body[CSRF_FIELD];
      bodyToken = typeof value === "string" ? value : undefined;
    }
    if (!bodyToken || !timingSafeEqual(bodyToken, cookieToken)) {
      return c.text("CSRF token mismatch", 403);
    }
    return next();
  }
);

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
