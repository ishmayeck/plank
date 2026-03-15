import "dotenv/config";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { authMiddleware } from "./auth/middleware.js";
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
app.route("/", profileRoute);
app.route("/", privmsgRoute);
app.route("/", searchRoute);
app.route("/", pollRoute);
app.route("/", modcpRoute);
app.route("/", groupcpRoute);
app.route("/", adminRoute);

export default app;
