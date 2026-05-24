import { healthy } from "@zmail/shared";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { AppConfig, AppLogin } from "./config.js";
import { loadConfigFromEnv } from "./config.js";
import { createHybridPersistence } from "./persistence.js";
import { syncMailboxTrees } from "./sync.js";

const sessionCookieName = "zmail_session";

export function createApp(config: AppConfig): Hono {
  const app = new Hono();
  const sessionToken = randomUUID();
  const persistence = config.persistence ?? createHybridPersistence();
  const mailboxSyncClient = config.mailboxSyncClient;

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

  return app;
}

export const app = createApp(loadConfigFromEnv());
