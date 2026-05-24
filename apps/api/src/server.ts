import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createGmailImapMailboxSyncClient } from "./gmail-imap.js";

const port = Number(process.env.PORT ?? 3001);
const gmailImapClient = createGmailImapMailboxSyncClient();
const app = createApp({
  ...loadConfig(),
  mailboxSyncClient: gmailImapClient,
  messageSyncClient: gmailImapClient,
});

serve({ fetch: app.fetch, port });

console.log(`Zmail API listening on http://localhost:${port}`);
