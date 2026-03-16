import { createMiddleware } from "hono/factory";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createClient } from "@supabase/supabase-js";

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  userLevel: number;
  unreadPms: number;
  lastVisit: string | null;
  userSig: string;
}

// Extend Hono's context variables
declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser | null;
    supabase: ReturnType<typeof createClient>;
  }
}

/**
 * Auth middleware: extracts session from cookies, attaches user + supabase client to context.
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

  // Create a per-request Supabase client
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const accessToken = getCookie(c, "sb-access-token");
  const refreshToken = getCookie(c, "sb-refresh-token");

  let user: AuthUser | null = null;

  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (!error && data.session) {
      // Refresh cookies if tokens changed
      if (data.session.access_token !== accessToken) {
        setCookie(c, "sb-access-token", data.session.access_token, {
          httpOnly: true,
          sameSite: "Lax",
          path: "/",
          maxAge: 60 * 60 * 24 * 7, // 7 days
        });
        setCookie(c, "sb-refresh-token", data.session.refresh_token!, {
          httpOnly: true,
          sameSite: "Lax",
          path: "/",
          maxAge: 60 * 60 * 24 * 30, // 30 days
        });
      }

      // Fetch profile data
      const { data: profile } = await supabase
        .from("profiles")
        .select("username, user_level, user_lastvisit, user_sig")
        .eq("id", data.session.user.id)
        .single();

      if (profile) {
        user = {
          id: data.session.user.id,
          username: profile.username,
          email: data.session.user.email!,
          userLevel: profile.user_level,
          unreadPms: 0, // TODO: query actual count
          lastVisit: profile.user_lastvisit,
          userSig: profile.user_sig ?? "",
        };
      }
    }
  }

  c.set("user", user);
  c.set("supabase", supabase);

  // Track session (fire-and-forget, don't block the request).
  // Only track page-level GETs (not static assets, API calls, etc.)
  const sessionPage = c.req.path;
  if (c.req.method === "GET" && !sessionPage.startsWith("/static/") && !sessionPage.startsWith("/templates/")) {
    const clientIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
      ?? c.req.header("x-real-ip")
      ?? null;
    const adminDb = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    // Use access token prefix as session ID for logged-in users, or a cookie-based guest ID
    const sessionId = accessToken?.slice(0, 32) ?? getCookie(c, "plank-sid") ?? crypto.randomUUID();
    if (!accessToken && !getCookie(c, "plank-sid")) {
      setCookie(c, "plank-sid", sessionId, {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
        maxAge: 60 * 60, // 1 hour
      });
    }
    const now = new Date().toISOString();
    adminDb.from("sessions").upsert({
      session_id: sessionId,
      user_id: user?.id ?? null,
      session_logged_in: !!user,
      session_time: now,
      session_start: now,
      session_ip: clientIp,
      session_page: sessionPage,
    }, { onConflict: "session_id" }).then(() => {});
  }

  await next();
});

/**
 * Middleware that requires authentication. Redirects to /login if not authenticated.
 */
export const requireAuth = createMiddleware(async (c, next) => {
  const user = c.get("user");
  if (!user) {
    return c.redirect("/login");
  }
  await next();
});

/**
 * Middleware that requires admin level. Returns 403 if not admin.
 */
export const requireAdmin = createMiddleware(async (c, next) => {
  const user = c.get("user");
  if (!user || user.userLevel < 1) {
    return c.text("Forbidden", 403);
  }
  await next();
});
