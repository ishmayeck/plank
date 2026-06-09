import type { Hono } from "hono";
import { csrf } from "hono/csrf";
import { authMiddleware } from "./auth/middleware.js";
import { csrfTokenMiddleware } from "./lib/csrf.js";
import authRoutes from "./routes/auth.js";
import indexRoute from "./routes/index.js";
import viewforumRoute from "./routes/viewforum.js";
import viewtopicRoute from "./routes/viewtopic.js";
import postingRoute from "./routes/posting.js";
import profileRoute from "./routes/profile.js";
import privmsgRoute from "./routes/privmsg.js";
import searchRoute from "./routes/search.js";
import pollRoute from "./routes/poll.js";
import modcpRoute from "./routes/modcp.js";
import groupcpRoute from "./routes/groupcp.js";
import adminRoute from "./routes/admin.js";
import pagesRoute from "./routes/pages.js";

/**
 * Wire Plank's middleware and routes onto a Hono app.
 *
 * Runtime-agnostic: no filesystem, no dotenv, no Node server — this module
 * must stay importable on Supabase Edge / Workers. Callers register any
 * static-asset handlers BEFORE calling this (so they short-circuit ahead of
 * the CSRF/auth middleware, as the Node entry does with serveStatic), then
 * serve `app.fetch` however their platform expects. See src/app.ts (Node)
 * and src/edge.ts (Supabase Edge Functions).
 */
export function registerApp(app: Hono): Hono {
  // CSRF defenses (in order: Origin/Referer check, then synchronizer-token check).
  // Tests can bypass with SKIP_CSRF=1 — production must never set this.
  // Checked at request time so a single test file can flip it.
  const honoCsrf = csrf();
  app.use("*", async (c, next) => {
    if (process.env.SKIP_CSRF === "1") return next();
    return honoCsrf(c, next);
  });
  app.use("*", async (c, next) => {
    if (process.env.SKIP_CSRF === "1") return next();
    return csrfTokenMiddleware(c, next);
  });

  // Auth middleware on all routes
  app.use("*", authMiddleware);

  // Routes
  app.route("/", authRoutes);
  app.route("/", indexRoute);
  app.route("/", viewforumRoute);
  app.route("/", viewtopicRoute);
  app.route("/", postingRoute);
  app.route("/", profileRoute);
  app.route("/", privmsgRoute);
  app.route("/", searchRoute);
  app.route("/", pollRoute);
  app.route("/", modcpRoute);
  app.route("/", groupcpRoute);
  app.route("/", adminRoute);
  app.route("/", pagesRoute);

  return app;
}
