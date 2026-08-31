import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { getCookie, setCookie } from "hono/cookie";
import { markup, type MarkupString } from "./markup.js";
import { escapeHtml } from "./escape.js";
import { CSRF_COOKIE_OPTS } from "../auth/cookies.js";

const CSRF_COOKIE = "plank-csrf";
const CSRF_FIELD = "_csrf";

declare module "hono" {
  interface ContextVariableMap {
    /** Per-request memo so every form on a page gets the same token. */
    csrfToken?: string;
  }
}

/**
 * Get the per-session CSRF token from the cookie, creating a fresh one
 * (and setting the cookie) if absent. The token is stable for the
 * lifetime of the cookie.
 *
 * The cookie is httpOnly — JS can't read it. The server reads it from
 * the request and embeds the value into form fields via csrfField().
 */
export function getCsrfToken(c: Context): string {
  // Memoized per request. getCookie reads the REQUEST header, not the
  // Set-Cookie we may have just queued — so without this, every call during a
  // first visit (when no cookie exists yet) mints a NEW token and re-sets the
  // cookie. A page rendering several forms would hand each a different token
  // and only the last would match the cookie the browser kept; the rest fail
  // validation. It self-heals on the second request, which is why it hid.
  const cached = c.get("csrfToken");
  if (cached) return cached;

  let token = getCookie(c, CSRF_COOKIE);
  if (!token) {
    token = generateToken();
    setCookie(c, CSRF_COOKIE, token, CSRF_COOKIE_OPTS);
  }
  c.set("csrfToken", token);
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

/**
 * Inject the CSRF token into every POST form in an HTML response that doesn't
 * already carry one.
 *
 * Why a response rewrite rather than fixing each form: original phpBB2
 * templates hard-code `<form method="post" action="{S_..._ACTION}">` with no
 * `S_HIDDEN_FIELDS` slot inside them — memberlist_body, viewforum_body,
 * admin/forum_admin_body and admin/ranks_list_body all do. Plank renders
 * themes UNMODIFIED (that's the point of the project), so there is nowhere to
 * put the field from the controller. Per-form patches also don't generalise:
 * Chunk 23 lets an admin drop in any third-party phpBB2 theme, and those
 * templates will have the same shape.
 *
 * Doing it here makes "every state-changing form carries a token" true by
 * construction for any theme, present or future, instead of a rule each new
 * form has to remember. Forms that already inject a token via
 * formHiddenFields() are left untouched.
 */
export const csrfFormInjectionMiddleware: MiddlewareHandler = createMiddleware(
  async (c, next) => {
    // Resolve the token BEFORE the response exists. getCsrfToken may set the
    // cookie, and setting a header once the body has been consumed makes Hono
    // rebuild the Response from a disturbed stream.
    const token = getCsrfToken(c);

    await next();

    const contentType = c.res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return;

    const body = await c.res.text();
    if (!/<form\b/i.test(body)) {
      c.res = new Response(body, c.res);
      return;
    }

    const field = csrfField(token).html;
    const rewritten = body.replace(
      // Forms can't nest in valid HTML, so a non-greedy body match is safe.
      /(<form\b[^>]*>)([\s\S]*?)(<\/form>)/gi,
      (match, open: string, inner: string, close: string) => {
        if (!/method\s*=\s*["']?\s*post/i.test(open)) return match;
        if (/name\s*=\s*["']_csrf["']/i.test(inner)) return match;
        return `${open}${field}${inner}${close}`;
      }
    );

    c.res = new Response(rewritten, c.res);
  }
);

/**
 * Validate a CSRF token supplied in the QUERY STRING, for actions triggered by
 * a plain link rather than a form.
 *
 * The admin panel's delete/reorder/resync controls are `<a href>` links in
 * unmodified phpBB2 templates — there is no form to attach a hidden field to,
 * and the handlers mutate on GET, which the token middleware treats as a safe
 * method and never checks. That left them reachable by an `<img src>` on any
 * page an admin happened to visit; forum deletion cascades to its topics and
 * posts. Putting the token in the URL is the standard answer for link-driven
 * actions: an attacker can't guess it, so they can't forge the link.
 *
 * Callers must be genuinely admin-gated as well — this only proves intent,
 * not authority.
 */
export function validateQueryCsrf(c: Context): boolean {
  if (process.env.SKIP_CSRF === "1") return true;
  const provided = c.req.query(CSRF_FIELD);
  const cookieToken = getCookie(c, CSRF_COOKIE);
  if (!provided || !cookieToken) return false;
  return timingSafeEqual(provided, cookieToken);
}

/** `&_csrf=…` suffix for building an action link. */
export function csrfQueryParam(c: Context): string {
  return `${CSRF_FIELD}=${encodeURIComponent(getCsrfToken(c))}`;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
