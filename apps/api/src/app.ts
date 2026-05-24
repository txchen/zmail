import { healthy } from "@zmail/shared";
import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppConfig, AppLogin } from "./config.js";
import type { MailboxAction } from "./mailbox-actions.js";
import {
  createFileBackedHybridPersistence,
  createHybridPersistence,
  type MailDatabase,
} from "./persistence.js";
import { syncMailboxTrees, syncRecentMessages, type MailAccountSyncState } from "./sync.js";

const sessionCookieName = "zmail_session";

export function createApp(config: AppConfig): Hono {
  const app = new Hono();
  const persistence =
    config.persistence ??
    (config.storage
      ? createFileBackedHybridPersistence(config.storage.databaseDir)
      : createHybridPersistence());
  const mailboxSyncClient = config.mailboxSyncClient;
  const messageSyncClient = config.messageSyncClient;
  const mailboxActionClient = config.mailboxActionClient;
  const attachmentDownloadClient = config.attachmentDownloadClient;
  const sessionTtlDays = config.appLogin.sessionTtlDays ?? 365;
  const syncStates = new Map<string, MailAccountSyncState>();

  function syncStateFor(accountId: string): MailAccountSyncState {
    return syncStates.get(accountId) ?? { accountId, syncStatus: "stale" };
  }

  function saveSyncStates(states: MailAccountSyncState[]): void {
    for (const state of states) {
      syncStates.set(state.accountId, state);
    }
  }

  function sessionFromCookie(cookie: string | undefined): AppSession | undefined {
    const token = cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${sessionCookieName}=`))
      ?.slice(sessionCookieName.length + 1);

    if (!token) {
      return undefined;
    }

    return verifySessionToken(token, config.appLogin.sessionSecret);
  }

  function isAuthenticated(cookie: string | undefined): boolean {
    return sessionFromCookie(cookie) !== undefined;
  }

  function mailboxTreeResponse() {
    return {
      mailAccounts: config.mailAccounts.map((configuredAccount) => {
        const mailboxes = persistence.mailDatabaseFor(configuredAccount.id).listMailboxes();

        return {
          id: configuredAccount.id,
          emailAddress: configuredAccount.emailAddress,
          syncStatus: syncStateFor(configuredAccount.id).syncStatus,
          unreadCount: mailboxes.reduce((total, mailbox) => total + mailbox.unreadCount, 0),
          mailboxes,
        };
      }),
    };
  }

  app.get("/health", (c) => c.json(healthy));
  app.get("/api/health", (c) => c.json(healthy));

  app.post("/api/login", async (c) => {
    const body = await c.req.json<AppLogin>();

    if (body.username !== config.appLogin.username || body.password !== config.appLogin.password) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000).toISOString();
    const sessionToken = signSessionToken(
      {
        username: config.appLogin.username,
        expiresAt,
      },
      config.appLogin.sessionSecret,
    );

    c.header("set-cookie", `${sessionCookieName}=${sessionToken}; HttpOnly; SameSite=Lax; Path=/`);

    return c.body(null, 204);
  });

  app.get("/api/session", (c) => {
    const session = sessionFromCookie(c.req.header("cookie"));

    if (!session) {
      return c.json({ authenticated: false });
    }

    return c.json({
      authenticated: true,
      username: session.username,
      expiresAt: session.expiresAt,
    });
  });

  app.post("/api/logout", (c) => {
    c.header("set-cookie", `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);

    return c.body(null, 204);
  });

  app.get("/api/mail-accounts", (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    return c.json({
      mailAccounts: config.mailAccounts.map(({ id, emailAddress }) => ({
        id,
        emailAddress,
      })),
    });
  });

  app.get("/ai-api/mail-accounts", (c) =>
    c.json({
      mailAccounts: config.mailAccounts.map(({ id, emailAddress }) => ({
        id,
        emailAddress,
        syncStatus: syncStateFor(id).syncStatus,
      })),
    }),
  );

  app.get("/ai-api/messages/unread", (c) =>
    c.json({
      messages: config.mailAccounts.flatMap((account) =>
        persistence.mailDatabaseFor(account.id).listUnreadMessages(account.id),
      ),
    }),
  );

  app.get("/ai-api/messages/:stableIdentity", (c) => {
    const stableIdentity = c.req.param("stableIdentity");

    for (const account of config.mailAccounts) {
      const message = persistence
        .mailDatabaseFor(account.id)
        .getMessageByStableIdentity(account.id, stableIdentity);

      if (message) {
        return c.json({ message });
      }
    }

    return c.json({ error: "Message not found" }, 404);
  });

  app.get("/api/mailbox-tree", (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    return c.json(mailboxTreeResponse());
  });

  app.post("/api/mail-accounts/:id/refresh", async (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    if (!mailboxSyncClient) {
      return c.json({ error: "Mailbox sync is not configured" }, 503);
    }

    const account = config.mailAccounts.find((candidate) => candidate.id === c.req.param("id"));

    if (!account) {
      return c.json({ error: "Mail account not found" }, 404);
    }

    const syncResults = await syncMailboxTrees({
      accounts: [account],
      persistence,
      client: mailboxSyncClient,
    });
    if (messageSyncClient) {
      await syncRecentMessages({
        accounts: [account],
        persistence,
        client: messageSyncClient,
        syncWindowDays: config.sync?.recentMessageWindowDays,
      });
    }
    saveSyncStates(syncResults);

    return c.json(mailboxTreeResponse());
  });

  app.get("/api/mail-accounts/:accountId/sync-status", (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const accountId = c.req.param("accountId");
    const account = config.mailAccounts.find((candidate) => candidate.id === accountId);

    if (!account) {
      return c.json({ error: "Mail account not found" }, 404);
    }

    const syncState = syncStateFor(accountId);

    return c.json({
      accountId,
      syncStatus: syncState.syncStatus,
      ...(syncState.lastSyncStartedAt ? { lastSyncStartedAt: syncState.lastSyncStartedAt } : {}),
      ...(syncState.lastSyncFinishedAt ? { lastSyncFinishedAt: syncState.lastSyncFinishedAt } : {}),
      ...(syncState.lastError ? { lastError: syncState.lastError } : {}),
    });
  });

  app.post("/api/mail-accounts/:accountId/diagnose", async (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    if (!mailboxSyncClient) {
      return c.json({ error: "Mailbox sync is not configured" }, 503);
    }

    const account = config.mailAccounts.find(
      (candidate) => candidate.id === c.req.param("accountId"),
    );

    if (!account) {
      return c.json({ error: "Mail account not found" }, 404);
    }

    try {
      const mailboxes = await mailboxSyncClient.listVisibleMailboxes(account);

      return c.json({
        success: true,
        visibleMailboxCount: mailboxes.length,
      });
    } catch (error) {
      return c.json({
        success: false,
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/mail-accounts/:accountId/mailboxes/:mailboxId/messages", (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const cursor = parseMessageCursor(c.req.query("cursor"));
    if (cursor === null) {
      return c.json({ error: "Invalid cursor" }, 400);
    }

    return c.json({
      ...persistence
        .mailDatabaseFor(c.req.param("accountId"))
        .listMessagesForMailbox(c.req.param("accountId"), c.req.param("mailboxId"), {
          limit: parseLimit(c.req.query("limit")),
          ...(cursor ? { cursor } : {}),
          filters: {
            unread: parseBooleanQuery(c.req.query("unread")),
            starred: parseBooleanQuery(c.req.query("starred")),
            hasAttachments: parseBooleanQuery(c.req.query("hasAttachments")),
            from: c.req.query("from"),
            after: c.req.query("after"),
            before: c.req.query("before"),
          },
        }),
    });
  });

  app.get("/api/mail-accounts/:accountId/messages/unread", (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const accountId = c.req.param("accountId");
    if (!config.mailAccounts.some((account) => account.id === accountId)) {
      return c.json({ error: "Mail account not found" }, 404);
    }

    const cursor = parseMessageCursor(c.req.query("cursor"));
    if (cursor === null) {
      return c.json({ error: "Invalid cursor" }, 400);
    }

    return c.json(
      paginateMessageSummaries(
        persistence.mailDatabaseFor(accountId).listUnreadMessages(accountId),
        {
          limit: parseLimit(c.req.query("limit")),
          ...(cursor ? { cursor } : {}),
          filters: {
            starred: parseBooleanQuery(c.req.query("starred")),
            hasAttachments: parseBooleanQuery(c.req.query("hasAttachments")),
            from: c.req.query("from"),
            after: c.req.query("after"),
            before: c.req.query("before"),
          },
        },
      ),
    );
  });

  app.get("/api/mail-accounts/:accountId/messages/search", (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const accountId = c.req.param("accountId");
    if (!config.mailAccounts.some((account) => account.id === accountId)) {
      return c.json({ error: "Mail account not found" }, 404);
    }

    const query = c.req.query("q")?.trim();
    if (!query) {
      return c.json({ error: "Search query is required" }, 400);
    }

    const cursor = parseMessageCursor(c.req.query("cursor"));
    if (cursor === null) {
      return c.json({ error: "Invalid cursor" }, 400);
    }

    return c.json(
      paginateMessageSummaries(
        persistence.mailDatabaseFor(accountId).searchMessages(accountId, query),
        {
          limit: parseLimit(c.req.query("limit")),
          ...(cursor ? { cursor } : {}),
          filters: {
            starred: parseBooleanQuery(c.req.query("starred")),
            hasAttachments: parseBooleanQuery(c.req.query("hasAttachments")),
            from: c.req.query("from"),
            after: c.req.query("after"),
            before: c.req.query("before"),
          },
        },
      ),
    );
  });

  app.get("/api/mail-accounts/:accountId/messages/:messageId", (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const message = persistence
      .mailDatabaseFor(c.req.param("accountId"))
      .getMessage(c.req.param("accountId"), c.req.param("messageId"));

    if (!message) {
      return c.json({ error: "Message not found" }, 404);
    }

    return c.json({ message });
  });

  app.get(
    "/api/mail-accounts/:accountId/messages/:messageId/attachments/:attachmentId",
    async (c) => {
      if (!isAuthenticated(c.req.header("cookie"))) {
        return c.json({ error: "Authentication required" }, 401);
      }

      if (!attachmentDownloadClient) {
        return c.json({ error: "Attachment download is not configured" }, 503);
      }

      const accountId = c.req.param("accountId");
      if (!config.mailAccounts.some((account) => account.id === accountId)) {
        return c.json({ error: "Mail account not found" }, 404);
      }

      const messageId = c.req.param("messageId");
      const attachmentId = c.req.param("attachmentId");
      const message = persistence.mailDatabaseFor(accountId).getMessage(accountId, messageId);

      if (!message) {
        return c.json({ error: "Message not found" }, 404);
      }

      const attachment = message.attachments.find((candidate) => candidate.id === attachmentId);
      if (!attachment) {
        return c.json({ error: "Attachment not found" }, 404);
      }

      try {
        const bytes = await attachmentDownloadClient.downloadAttachment({
          accountId,
          messageId,
          attachmentId,
        });

        const body = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(body).set(bytes);

        return new Response(body, {
          headers: {
            "content-type": attachment.mimeType,
            "content-disposition": `attachment; filename="${attachment.filename}"`,
          },
        });
      } catch {
        return c.json({ error: "Attachment download failed" }, 502);
      }
    },
  );

  app.post("/api/mail-accounts/:accountId/messages/actions", async (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    if (!mailboxActionClient) {
      return c.json({ error: "Mailbox actions are not configured" }, 503);
    }

    const accountId = c.req.param("accountId");
    const body = await c.req.json<{ action: string; messageIds: string[] }>();

    if (!isMailboxAction(body.action)) {
      return c.json({ error: "Unsupported Mailbox action" }, 400);
    }

    const succeededIds: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const messageId of body.messageIds ?? []) {
      const result = await performMailboxActionForMessage(accountId, messageId, body.action);

      if (result.ok) {
        succeededIds.push(messageId);
      } else {
        failed.push({ id: messageId, error: result.error });
      }
    }

    return c.json({ succeededIds, failed });
  });

  app.post("/api/mail-accounts/:accountId/messages/:messageId/actions", async (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    if (!mailboxActionClient) {
      return c.json({ error: "Mailbox actions are not configured" }, 503);
    }

    const accountId = c.req.param("accountId");
    const messageId = c.req.param("messageId");
    const body = await c.req.json<{ action: MailboxAction }>();
    const target = { accountId, messageId };

    try {
      await mailboxActionClient[body.action](target);
    } catch {
      return c.json({ error: "Mailbox action failed" }, 502);
    }

    const mailDatabase = persistence.mailDatabaseFor(accountId);

    if (body.action === "markRead") {
      mailDatabase.setMessageUnread(messageId, false);
    }

    if (body.action === "markUnread") {
      mailDatabase.setMessageUnread(messageId, true);
    }

    if (body.action === "star") {
      mailDatabase.setMessageStarred(messageId, true);
    }

    if (body.action === "unstar") {
      mailDatabase.setMessageStarred(messageId, false);
    }

    if (body.action === "archive") {
      mailDatabase.removeMailboxEntry(messageId, "inbox");
    }

    if (body.action === "delete") {
      mailDatabase.removeMailboxEntry(messageId, "inbox");
      mailDatabase.saveMailboxEntry({
        id: `${messageId}:trash`,
        mailboxId: "trash",
        messageId,
      });
    }

    const message = mailDatabase.getMessage(accountId, messageId);

    if (!message) {
      return c.json({ error: "Message not found" }, 404);
    }

    return c.json({ message });
  });

  return app;

  async function performMailboxActionForMessage(
    accountId: string,
    messageId: string,
    action: MailboxAction,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const mailDatabase = persistence.mailDatabaseFor(accountId);

    if (!mailDatabase.getMessage(accountId, messageId)) {
      return { ok: false, error: "Message not found" };
    }

    const target = { accountId, messageId };

    try {
      await mailboxActionClient?.[action](target);
    } catch {
      return { ok: false, error: "Mailbox action failed" };
    }

    applyLocalMailboxAction(mailDatabase, messageId, action);

    return { ok: true };
  }
}

function isMailboxAction(action: string): action is MailboxAction {
  return ["markRead", "markUnread", "archive", "delete", "star", "unstar"].includes(action);
}

function applyLocalMailboxAction(
  mailDatabase: MailDatabase,
  messageId: string,
  action: MailboxAction,
): void {
  if (action === "markRead") {
    mailDatabase.setMessageUnread(messageId, false);
  }

  if (action === "markUnread") {
    mailDatabase.setMessageUnread(messageId, true);
  }

  if (action === "star") {
    mailDatabase.setMessageStarred(messageId, true);
  }

  if (action === "unstar") {
    mailDatabase.setMessageStarred(messageId, false);
  }

  if (action === "archive") {
    mailDatabase.removeMailboxEntry(messageId, "inbox");
  }

  if (action === "delete") {
    mailDatabase.removeMailboxEntry(messageId, "inbox");
    mailDatabase.saveMailboxEntry({
      id: `${messageId}:trash`,
      mailboxId: "trash",
      messageId,
    });
  }
}

export const app = createApp({
  appLogin: {
    username: "test",
    password: "test",
    sessionSecret: "test-session-secret",
  },
  storage: {
    databaseDir: ":memory:",
  },
  sync: {
    recentMessageWindowDays: 90,
  },
  mailAccounts: [],
  persistence: createHybridPersistence(),
});

type AppSession = {
  username: string;
  expiresAt: string;
};

function signSessionToken(session: AppSession, secret: string): string {
  const encodedHeader = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const encodedPayload = base64UrlEncode(JSON.stringify(session));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = sign(unsignedToken, secret);

  return `${unsignedToken}.${signature}`;
}

function verifySessionToken(token: string, secret: string): AppSession | undefined {
  const [encodedHeader, encodedPayload, signature, extra] = token.split(".");

  if (!encodedHeader || !encodedPayload || !signature || extra !== undefined) {
    return undefined;
  }

  if (!safeEqual(signature, sign(`${encodedHeader}.${encodedPayload}`, secret))) {
    return undefined;
  }

  let parsed: Partial<AppSession>;

  try {
    parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<AppSession>;
  } catch {
    return undefined;
  }

  if (typeof parsed.username !== "string" || typeof parsed.expiresAt !== "string") {
    return undefined;
  }

  if (Date.parse(parsed.expiresAt) <= Date.now()) {
    return undefined;
  }

  return {
    username: parsed.username,
    expiresAt: parsed.expiresAt,
  };
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined;
  }

  return Math.min(parsed, 200);
}

function parseBooleanQuery(value: string | undefined): boolean | undefined {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return undefined;
}

function parseMessageCursor(
  value: string | undefined,
): { receivedAt: string; id: string } | undefined | null {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<{
      receivedAt: string;
      id: string;
    }>;

    if (typeof parsed.receivedAt !== "string" || typeof parsed.id !== "string") {
      return null;
    }

    return {
      receivedAt: parsed.receivedAt,
      id: parsed.id,
    };
  } catch {
    return null;
  }
}

type MessageSummaryLike = {
  id: string;
  receivedAt: string;
  starred: boolean;
  sender: { address: string };
  attachmentCount: number;
};

function paginateMessageSummaries<T extends MessageSummaryLike>(
  messages: T[],
  options: {
    limit?: number;
    cursor?: { receivedAt: string; id: string };
    filters?: {
      starred?: boolean;
      hasAttachments?: boolean;
      from?: string;
      after?: string;
      before?: string;
    };
  },
): { messages: T[]; nextCursor?: string } {
  const limit = Math.min(options.limit ?? 50, 200);
  const filtered = messages
    .filter(
      (message) =>
        options.filters?.starred === undefined || message.starred === options.filters.starred,
    )
    .filter(
      (message) =>
        options.filters?.hasAttachments === undefined ||
        message.attachmentCount > 0 === options.filters.hasAttachments,
    )
    .filter(
      (message) =>
        !options.filters?.from ||
        message.sender.address.toLowerCase() === options.filters.from.toLowerCase(),
    )
    .filter((message) => !options.filters?.after || message.receivedAt > options.filters.after)
    .filter((message) => !options.filters?.before || message.receivedAt < options.filters.before)
    .filter(
      (message) =>
        !options.cursor ||
        message.receivedAt < options.cursor.receivedAt ||
        (message.receivedAt === options.cursor.receivedAt && message.id < options.cursor.id),
    );
  const pageMessages = filtered.slice(0, limit);
  const lastMessage = pageMessages.at(-1);

  return {
    messages: pageMessages,
    ...(filtered.length > limit && lastMessage
      ? { nextCursor: encodeMessageCursor(lastMessage.receivedAt, lastMessage.id) }
      : {}),
  };
}

function encodeMessageCursor(receivedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ receivedAt, id }), "utf8").toString("base64url");
}
