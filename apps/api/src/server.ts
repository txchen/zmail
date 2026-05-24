import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfigFromEnv } from "./config.js";

const port = Number(process.env.PORT ?? 3001);
const app = createApp(loadConfigFromEnv());

serve({ fetch: app.fetch, port });

console.log(`Zmail API listening on http://localhost:${port}`);
