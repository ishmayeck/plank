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
    headers.set("x-forwarded-host", url.hostname);
    headers.set("x-forwarded-proto", "https");
    // Real client IP for the function's rate limiter. Supabase's gateway
    // may prepend its own view of the chain; clientIp() takes the first
    // hop, so verify end-to-end after any gateway behavior change.
    const clientIp = request.headers.get("cf-connecting-ip");
    if (clientIp) headers.set("x-forwarded-for", clientIp);

    const res = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.body,
      // Pass 3xx through to the browser (e.g. our 302s to Storage assets)
      // instead of following them inside the worker.
      redirect: "manual",
    });

    const marker = res.headers.get("x-plank-content-type");
    if (!marker) return res;

    const out = new Response(res.body, res);
    out.headers.set("content-type", marker);
    out.headers.delete("x-plank-content-type");
    return out;
  },
};
