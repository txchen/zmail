import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import type {
  AccountOpenResponse,
  LiveMessageDetail,
  LiveMessagePage,
  MailboxAction,
} from "@zmail/shared";
import type { GmailImapReader } from "../apps/api/src/live-imap.js";
import { createServerApp } from "../apps/api/src/server-app.js";

const calls: string[] = [];
let trackingCalls = 0;
const failures = new Map<string, number>([["open", 1]]);
const message = {
  accountId: "personal",
  id: "gmail-message-1",
  subject: "Quiescent UI smoke",
  sender: { address: "sender@example.com", displayName: "Sender" },
  recipients: [{ address: "reader@example.com" }],
  receivedAt: "2026-07-17T12:00:00.000Z",
  unread: true,
  starred: false,
};
const detail: LiveMessageDetail = {
  ...message,
  ccRecipients: [],
  bccRecipients: [],
  readableBody: `<p>Focused browser smoke body.</p>
    <img src="cid:smoke@example.com">
    <img srcset="http://127.0.0.1:3001/api/__smoke/tracking.png 1x">
    <div style="background-image: url(http://127.0.0.1:3001/api/__smoke/tracking.png)">remote</div>`,
  plainTextBody: "Focused browser smoke body.",
  inlineResources: [
    {
      id: "inline-1",
      contentId: "smoke@example.com",
      mimeType: "image/png",
      sizeBytes: 68,
    },
  ],
  attachments: [
    {
      id: "attachment-1",
      filename: "smoke.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
    },
  ],
};
const page: LiveMessagePage = { messages: [message] };
const accountOpen: AccountOpenResponse = {
  mailAccount: {
    id: "personal",
    emailAddress: "reader@example.com",
    unreadCount: 1,
    mailboxes: [
      {
        id: "INBOX",
        name: "Inbox",
        path: "INBOX",
        systemRole: "inbox",
        unreadCount: 1,
        totalCount: 1,
        selectable: true,
      },
    ],
  },
  inbox: { mailboxId: "INBOX", ...page },
};

function record<T>(operation: string, value: T): T {
  calls.push(operation);
  const remaining = failures.get(operation) ?? 0;
  if (remaining > 0) {
    failures.set(operation, remaining - 1);
    throw new Error(`${operation} failed for smoke`);
  }
  return value;
}

const reader: GmailImapReader = {
  openAccount: async () => record("open", accountOpen),
  listMailbox: async () => record("list", page),
  listUnread: async () => record("unread", page),
  search: async () => record("search", page),
  refreshAccount: async (_account, request) =>
    record("refresh", {
      mailAccount: accountOpen.mailAccount,
      view: { ...request.view, ...page },
      ...(request.selectedMessageId
        ? { selectedMessageId: request.selectedMessageId, selectedMessage: message }
        : {}),
    }),
  readMessage: async () => record("detail", detail),
  readInlineResource: async () =>
    record("inline", {
      mimeType: "image/png",
      bytes: Uint8Array.from(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      ),
    }),
  downloadAttachment: async () =>
    record("attachment", {
      filename: "smoke.txt",
      mimeType: "text/plain",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("smoke"));
          controller.close();
        },
      }),
    }),
  performMailboxAction: async (_account, messageId, action: MailboxAction) =>
    record("action", {
      accountId: "personal",
      messageId,
      action,
      before: { unread: true, starred: false, inInbox: true, inTrash: false },
      after: {
        unread: action === "markRead" ? false : true,
        starred: false,
        inInbox: true,
        inTrash: false,
      },
    }),
  closeAllSessions: async () => {
    calls.push("closeAll");
  },
};

const app = createServerApp(
  {
    appLogin: {
      username: "reader",
      password: "secret",
      sessionSecret: "smoke-session-secret",
    },
    reader: { readDwellSeconds: 1 },
    mailAccounts: [
      {
        id: "personal",
        emailAddress: "reader@example.com",
        appPassword: "unused-fake-password",
      },
    ],
  },
  {
    webDistDir: resolve("apps/web/dist"),
    secureCookies: false,
    services: {
      gmailImapReader: reader,
    },
  },
);

app.get("/api/__smoke/state", (c) => c.json({ calls, trackingCalls }));
app.get("/api/__smoke/tracking.png", (c) => {
  trackingCalls += 1;
  return c.body(null, 204);
});
app.post("/api/__smoke/fail/:operation", (c) => {
  failures.set(c.req.param("operation"), 1);
  return c.body(null, 204);
});

serve({ fetch: app.fetch, port: 3001 });
console.log("Fake Live IMAP smoke server listening on http://localhost:3001");
