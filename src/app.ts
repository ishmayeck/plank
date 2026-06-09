import "dotenv/config";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { registerApp } from "./app_core.js";

/**
 * Node entry: filesystem static assets + the shared app core. This is what
 * dev, tests, and a Node/Docker deployment import. The Edge deployment uses
 * src/edge.ts instead (Storage-backed assets, precompiled templates).
 */
const app = new Hono();

// Serve theme static assets (CSS, images)
app.use(
  "/templates/Solaris/*",
  serveStatic({
    root: "./themes/",
    rewriteRequestPath: (path) => path.replace("/templates/", "/"),
  })
);

// Serve smiley images from phpBB2 source
app.use("/images/smiles/*", serveStatic({ root: "./vendor/phpBB2/" }));

// Serve phpBB2's root-level images (some templates reference images/spacer.gif etc.)
app.use("/images/*", serveStatic({ root: "./themes/Solaris/" }));

registerApp(app);

export default app;
