import { healthy } from "@zmail/shared";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { AppConfig, AppLogin } from "./config.js";
import { loadConfigFromEnv } from "./config.js";
import type { MailboxAction } from "./mailbox-actions.js";
import { createHybridPersistence } from "./persistence.js";
import { syncMailboxTrees } from "./sync.js";

const sessionCookieName = "zmail_session";

export function createApp(config: AppConfig): Hono {
  const app = new Hono();
  const sessionToken = randomUUID();
  const persistence = config.persistence ?? createHybridPersistence();
  const mailboxSyncClient = config.mailboxSyncClient;
  const mailboxActionClient = config.mailboxActionClient;

  function isAuthenticated(cookie: string | undefined): boolean {
    return cookie?.includes(`${sessionCookieName}=${sessionToken}`) ?? false;
  }

  function mailboxTreeResponse() {
    return {
      mailAccounts: persistence.app.listMailAccounts().map((account) => {
        const mailboxes = persistence.mailDatabaseFor(account.id).listMailboxes();

        return {
          ...account,
          unreadCount: mailboxes.reduce((total, mailbox) => total + mailbox.unreadCount, 0),
          mailboxes,
        };
      }),
    };
  }

  app.get("/health", (c) => c.json(healthy));

  app.post("/api/login", async (c) => {
    const body = await c.req.json<AppLogin>();

    if (body.username !== config.appLogin.username || body.password !== config.appLogin.password) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    c.header("set-cookie", `${sessionCookieName}=${sessionToken}; HttpOnly; SameSite=Lax; Path=/`);

    return c.body(null, 204);
  });

  app.get("/api/mail-accounts", (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    return c.json({
      mailAccounts: config.mailAccounts.map(({ id, displayName, emailAddress }) => ({
        id,
        displayName,
        emailAddress,
      })),
    });
  });

  app.get("/ai-api/mail-accounts", (c) =>
    c.json({
      mailAccounts: persistence.app.listMailAccounts(),
    }),
  );

  app.get("/ai-api/messages/unread", (c) =>
    c.json({
      messages: persistence.app
        .listMailAccounts()
        .flatMap((account) =>
          persistence.mailDatabaseFor(account.id).listUnreadMessages(account.id),
        ),
    }),
  );

  app.get("/ai-api/messages/:stableIdentity", (c) => {
    const stableIdentity = c.req.param("stableIdentity");

    for (const account of persistence.app.listMailAccounts()) {
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

    await syncMailboxTrees({
      accounts: [account],
      persistence,
      client: mailboxSyncClient,
    });

    return c.json(mailboxTreeResponse());
  });

  app.get("/api/mail-accounts/:accountId/mailboxes/:mailboxId/messages", (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    return c.json({
      messages: persistence
        .mailDatabaseFor(c.req.param("accountId"))
        .listMessagesForMailbox(c.req.param("mailboxId")),
    });
  });

  app.get("/api/mail-accounts/:accountId/messages/:messageId", (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const message = persistence
      .mailDatabaseFor(c.req.param("accountId"))
      .getMessage(c.req.param("messageId"));

    if (!message) {
      return c.json({ error: "Message not found" }, 404);
    }

    return c.json({ message });
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

    const message = mailDatabase.getMessage(messageId);

    if (!message) {
      return c.json({ error: "Message not found" }, 404);
    }

    return c.json({ message });
  });

  return app;
}

export const app = createApp(loadConfigFromEnv());
