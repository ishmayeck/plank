import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";

/**
 * Baseline security response headers.
 *
 * Plank served none at all. On the Edge deployment the Cloudflare front proxy
 * strips the gateway's lockdown CSP (correctly — `default-src 'none'; sandbox`
 * blocks every image, stylesheet and form on the page) and put nothing back,
 * so the escape-by-default engine was the only XSS defence with no second
 * layer behind it.
 *
 * The CSP here is deliberately a CONSERVATIVE subset. phpBB2 templates are
 * full of inline <script> blocks and inline event handlers, and the Edge
 * deployment serves theme CSS, images and smilies from a Supabase Storage
 * origin — so script-src/style-src/img-src restrictions would need per-
 * deployment origin lists and would break the site if they were wrong. The
 * four directives below constrain none of those resource types, so they are
 * safe to apply everywhere while still removing real capability from an
 * injected payload:
 *
 *   frame-ancestors 'self' — clickjacking. NOT 'none': the posting page loads
 *                            /posting_topic_review in a same-origin iframe.
 *   base-uri 'self'        — stops an injected <base> re-pointing every
 *                            relative URL on the page at another host.
 *   object-src 'none'      — no plugin embedding.
 *   form-action 'self'     — an injected form cannot POST credentials offsite.
 *
 * Tightening script-src is the remaining work and needs the deployment's real
 * asset origins; see DEPLOYMENT.md.
 */
const CSP = [
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

/** Two years, matching the usual preload threshold. */
const HSTS = "max-age=63072000; includeSubDomains";

export const securityHeadersMiddleware: MiddlewareHandler = createMiddleware(
  async (c, next) => {
    await next();

    // Don't stamp policy onto the 302s that point at the Storage bucket.
    const contentType = c.res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return;

    c.res.headers.set("Content-Security-Policy", CSP);
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    // Belt and braces with frame-ancestors, for older browsers.
    c.res.headers.set("X-Frame-Options", "SAMEORIGIN");
    c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

    // Only meaningful over TLS, and actively unhelpful on a plaintext dev
    // host, so key it off the same switch that governs Secure cookies.
    if (process.env.PLANK_COOKIE_INSECURE !== "1") {
      c.res.headers.set("Strict-Transport-Security", HSTS);
    }
  }
);
