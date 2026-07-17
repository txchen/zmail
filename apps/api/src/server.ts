import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import {
  createImapSessionCoordinator,
  type ImapClientSession,
} from "./imap-session-coordinator.js";
import { createGmailImapReader } from "./live-imap.js";
import { createServerApp } from "./server-app.js";

const port = Number(process.env.PORT ?? 3001);
const webDistDir = process.env.ZMAIL_WEB_DIST_DIR
  ? resolve(process.env.ZMAIL_WEB_DIST_DIR)
  : resolve(process.cwd(), "apps/web/dist");
const imapSessionCoordinator = createImapSessionCoordinator<ImapClientSession>();
const gmailImapReader = createGmailImapReader(undefined, imapSessionCoordinator);
const config = loadConfig();
const app = createServerApp(config, {
  webDistDir,
  secureCookies: process.env.NODE_ENV === "production",
  services: {
    gmailImapReader,
  },
});

serve({ fetch: app.fetch, port });

console.log(`Zmail API listening on http://localhost:${port}`);
