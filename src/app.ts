import "dotenv/config";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { authMiddleware } from "./auth/middleware.js";
import authRoutes from "./routes/auth.js";
import indexRoute from "./routes/index.js";
import viewforumRoute from "./routes/viewforum.js";
import viewtopicRoute from "./routes/viewtopic.js";
import postingRoute from "./routes/posting.js";

const app = new Hono();

// Serve theme static assets (CSS, images)
app.use(
  "/templates/Solaris/*",
  serveStatic({
    root: "./themes/",
    rewriteRequestPath: (path) => path.replace("/templates/", "/"),
  })
);

// Serve phpBB2's root-level images (some templates reference images/spacer.gif etc.)
app.use("/images/*", serveStatic({ root: "./themes/Solaris/" }));

// Auth middleware on all routes
app.use("*", authMiddleware);

// Routes
app.route("/", authRoutes);
app.route("/", indexRoute);
app.route("/", viewforumRoute);
app.route("/", viewtopicRoute);
app.route("/", postingRoute);

export default app;
