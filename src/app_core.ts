import type { Hono } from "hono";
import { csrf } from "hono/csrf";
import { authMiddleware } from "./auth/middleware.js";
import { csrfTokenMiddleware, csrfFormInjectionMiddleware } from "./lib/csrf.js";
import { securityHeadersMiddleware } from "./lib/headers.js";
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
  // Baseline response headers. First so they land on every response,
  // including the 403s the CSRF middlewares below can short-circuit with.
  app.use("*", securityHeadersMiddleware);

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
  // Backstop: stamp the token into any POST form the templates didn't already
  // carry one for. Original phpBB2 templates (and any drop-in theme, Chunk 23)
  // have no S_HIDDEN_FIELDS slot inside several of their forms, and we render
  // themes unmodified — so this is the only place the guarantee can be made
  // to hold for every theme rather than every remembered call site.
  app.use("*", async (c, next) => {
    if (process.env.SKIP_CSRF === "1") return next();
    return csrfFormInjectionMiddleware(c, next);
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
