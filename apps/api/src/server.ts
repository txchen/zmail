import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createAppWithServices } from "./app.js";
import { loadConfig } from "./config.js";
import { createGmailImapMailboxSyncClient } from "./gmail-imap.js";
import { createSyncScheduler } from "./scheduler.js";
import { serveStaticFile } from "./static-files.js";

const port = Number(process.env.PORT ?? 3001);
const webDistDir = process.env.ZMAIL_WEB_DIST_DIR
  ? resolve(process.env.ZMAIL_WEB_DIST_DIR)
  : resolve(process.cwd(), "apps/web/dist");
const gmailImapClient = createGmailImapMailboxSyncClient();
const config = loadConfig();
const { app, syncQueue } = createAppWithServices({
  ...config,
  mailboxSyncClient: gmailImapClient,
  messageSyncClient: gmailImapClient,
  mailboxActionClient: gmailImapClient,
});
const syncScheduler = createSyncScheduler({
  accounts: config.mailAccounts,
  sync: config.sync,
  syncQueue,
});

syncScheduler.start();

if (existsSync(webDistDir)) {
  app.get("*", async (c, next) => {
    const pathname = new URL(c.req.url).pathname;

    if (pathname.startsWith("/api/") || pathname.startsWith("/ai-api/") || pathname === "/health") {
      return next();
    }

    return serveStaticFile(webDistDir, pathname);
  });
}

serve({ fetch: app.fetch, port });

console.log(`Zmail API listening on http://localhost:${port}`);
