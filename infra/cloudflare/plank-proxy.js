/**
 * Cloudflare Worker: front door for the Plank Edge Function.
 *
 * Why this exists (see DEPLOYMENT.md "shared-domain HTML policy"):
 *  1. Maps clean root paths (forum.example.com/viewforum/1) onto the
 *     function's real mount point (/functions/v1/plank/viewforum/1).
 *  2. Restores the Content-Type that Supabase's shared functions domain
 *     rewrites away: the Edge function declares its true type in
 *     x-plank-content-type (set in src/edge.ts), and this worker copies it
 *     back into Content-Type.
 *  3. Forwards the public host + real client IP so the Edge function's
 *     CSRF origin check, redirects, and per-IP rate limiting see the user,
 *     not the proxy. (src/edge.ts honors x-forwarded-host.)
 *
 * Deploy: wrangler deploy from infra/cloudflare/, then attach a route or
 * custom domain to the worker in the Cloudflare dashboard.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const upstream = new URL(url);
    upstream.protocol = "https:";
    upstream.hostname = env.SUPABASE_FUNCTION_HOST; // <ref>.supabase.co
    upstream.port = "";
    upstream.pathname = `/functions/v1/plank${url.pathname}`;

    const headers = new Headers(request.headers);
    // Supabase's gateway strips inbound x-forwarded-host and rewrites
    // x-forwarded-for, so the public host and real client IP are tunneled
    // in custom x-plank-* headers; src/edge.ts translates them back.
    // (Verified: custom headers pass the gateway; the standard ones don't.)
    headers.set("x-plank-forwarded-host", url.hostname);
    const clientIp = request.headers.get("cf-connecting-ip");
    if (clientIp) headers.set("x-plank-client-ip", clientIp);

    // Strip any inbound copies before setting our own, so a visitor can't
    // pre-supply the tunnelled values and have them survive to the function.
    // (Headers.set replaces, but be explicit about the intent.)
    headers.delete("x-plank-proxy-secret");

    // Prove to the function that this request came through the proxy. Without
    // it the function is reachable directly at its …supabase.co URL and the
    // tunnelled client IP above is attacker-controlled — which would make the
    // per-IP rate limits bypassable by rotating a header value. Set the same
    // value on both sides:
    //   wrangler secret put PLANK_PROXY_SECRET
    //   supabase secrets set PLANK_PROXY_SECRET=<same value>
    if (env.PLANK_PROXY_SECRET) {
      headers.set("x-plank-proxy-secret", env.PLANK_PROXY_SECRET);
    }

    const res = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.body,
      // Pass 3xx through to the browser (e.g. our 302s to Storage assets)
      // instead of following them inside the worker.
      redirect: "manual",
    });

    const out = new Response(res.body, res);

    // The gateway stamps a lockdown CSP (default-src 'none'; sandbox) on
    // every function response — in a browser that blocks all images, CSS,
    // and even form submissions. Plank owns its response policy; dropping
    // the header matches the Node entry (which serves no CSP). A
    // Plank-authored CSP is a separate hardening item (DEPLOYMENT.md).
    out.headers.delete("content-security-policy");
    out.headers.delete("content-security-policy-report-only");

    const marker = out.headers.get("x-plank-content-type");
    if (marker) {
      out.headers.set("content-type", marker);
      out.headers.delete("x-plank-content-type");
    }
    return out;
  },
};
