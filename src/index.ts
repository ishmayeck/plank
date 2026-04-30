import { serve } from "@hono/node-server";
import { loadConfig } from "./lib/config.js";
import app from "./app.js";

loadConfig();

const port = 3000;
console.log(`Plank running at http://localhost:${port}`);
serve({ fetch: app.fetch, port });
