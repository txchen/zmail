import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createAppWithServices } from "./app.js";
import { loadConfig } from "./config.js";
import { createGmailImapMailboxSyncClient } from "./gmail-imap.js";
import { createSyncScheduler } from "./scheduler.js";

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

    const filePath = safeStaticFilePath(webDistDir, pathname);
    const bytes = await readFile(filePath).catch(() => readFile(join(webDistDir, "index.html")));

    return new Response(bytes, {
      headers: {
        "content-type": contentTypeFor(filePath),
      },
    });
  });
}

serve({ fetch: app.fetch, port });

console.log(`Zmail API listening on http://localhost:${port}`);

function safeStaticFilePath(root: string, pathname: string): string {
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
  const filePath = resolve(root, relativePath);

  if (!filePath.startsWith(root)) {
    return join(root, "index.html");
  }

  return filePath;
}

function contentTypeFor(filePath: string): string {
  switch (extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}
