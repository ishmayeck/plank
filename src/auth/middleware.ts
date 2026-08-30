import { createMiddleware } from "hono/factory";
import { getCookie, setCookie } from "hono/cookie";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../db/client.js";
import { ACCESS_COOKIE_OPTS, REFRESH_COOKIE_OPTS, GUEST_SID_COOKIE_OPTS } from "./cookies.js";

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  userLevel: number;
  unreadPms: number;
  lastVisit: string | null;
  userSig: string;
  attachSig: boolean;
}

// Extend Hono's context variables
declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser | null;
    supabase: ReturnType<typeof createClient>;
  }
}

// PM types matching the schema comment in the initial migration:
// 0=not read, 1=read, 2=new (notification). 0 and 2 both count as unread.
const PM_TYPE_UNREAD = 0;
const PM_TYPE_NEW = 2;

/**
 * Auth middleware: extracts session from cookies, attaches user + supabase client to context.
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

  // Create a per-request Supabase client. setSession() mutates client
  // state, so this client cannot be shared across requests.
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
        setCookie(c, "sb-access-token", data.session.access_token, ACCESS_COOKIE_OPTS);
        setCookie(c, "sb-refresh-token", data.session.refresh_token!, REFRESH_COOKIE_OPTS);
      }

      const adminDb = getSupabaseAdmin();

      const [profileRes, unreadRes] = await Promise.all([
        adminDb
          .from("profiles")
          .select("username, user_level, user_lastvisit, user_sig, user_attachsig")
          .eq("id", data.session.user.id)
          .maybeSingle(),
        adminDb
          .from("privmsgs")
          .select("id", { count: "exact", head: true })
          .eq("privmsgs_to_userid", data.session.user.id)
          .in("privmsgs_type", [PM_TYPE_UNREAD, PM_TYPE_NEW]),
      ]);

      const profile = profileRes.data;
      if (profile) {
        user = {
          id: data.session.user.id,
          username: profile.username,
          email: data.session.user.email!,
          userLevel: profile.user_level,
          unreadPms: unreadRes.count ?? 0,
          lastVisit: profile.user_lastvisit,
          userSig: profile.user_sig ?? "",
          attachSig: profile.user_attachsig ?? false,
        };
      }
    }
  }

  c.set("user", user);
  c.set("supabase", supabase);

  // Track session for "who's online" — fire-and-forget, but log failures
  // so a broken sessions table doesn't go silently undetected.
  // Only track page-level GETs (skip static assets).
  const sessionPage = c.req.path;
  if (c.req.method === "GET" && !sessionPage.startsWith("/static/") && !sessionPage.startsWith("/templates/")) {
    const clientIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
      ?? c.req.header("x-real-ip")
      ?? null;
    const adminDb = getSupabaseAdmin();
    // Session id for "who's online".
    //
    // This used to be accessToken.slice(0, 32) for logged-in users, which is
    // a CONSTANT: a JWT's first 32 characters are entirely its base64 header,
    // and every token a project issues shares one header. So every logged-in
    // user upserted into the same row — who's-online showed exactly one
    // member, and that row carried whichever user most recently loaded a page,
    // along with their IP and current page. Key on the user id instead, which
    // is what the row actually represents.
    const sessionId = user
      ? `u:${user.id}`
      : getCookie(c, "plank-sid") ?? crypto.randomUUID();
    if (!user && !getCookie(c, "plank-sid")) {
      setCookie(c, "plank-sid", sessionId, GUEST_SID_COOKIE_OPTS);
    }
    // session_start is set by the column default on first insert and is
    // never touched on update — omit it from the payload.
    adminDb.from("sessions").upsert({
      session_id: sessionId,
      user_id: user?.id ?? null,
      session_logged_in: !!user,
      session_time: new Date().toISOString(),
      session_ip: clientIp,
      session_page: sessionPage,
    }, { onConflict: "session_id" }).then(({ error: upsertError }) => {
      if (upsertError) {
        console.error("session upsert failed:", upsertError);
      }
    });
  }

  await next();
});
