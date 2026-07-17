import type { MailboxAction } from "@zmail/shared";
import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppConfig, AppLogin } from "./config.js";
import { logError, logInfo } from "./logger.js";

const sessionCookieName = "zmail_session";
const healthy = {
  service: "zmail-api" as const,
  status: "ok" as const,
};

export function createApp(config: AppConfig): Hono {
  const app = new Hono();
  const sessionTtlDays = config.appLogin.sessionTtlDays ?? 365;

  function sessionFromCookie(cookie: string | undefined): AppSession | undefined {
    const token = cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${sessionCookieName}=`))
      ?.slice(sessionCookieName.length + 1);

    return token ? verifySessionToken(token, config.appLogin.sessionSecret) : undefined;
  }

  function isAuthenticated(cookie: string | undefined): boolean {
    return sessionFromCookie(cookie) !== undefined;
  }

  app.get("/health", (c) => c.json(healthy));
  app.get("/api/health", (c) => c.json(healthy));

  app.post("/api/login", async (c) => {
    const body = await c.req.json<AppLogin>();

    if (body.username !== config.appLogin.username || body.password !== config.appLogin.password) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000).toISOString();
    const token = signSessionToken(
      { username: config.appLogin.username, expiresAt },
      config.appLogin.sessionSecret,
    );
    c.header("set-cookie", sessionCookie(token, config.secureCookies));
    return c.body(null, 204);
  });

  app.get("/api/session", (c) => {
    const session = sessionFromCookie(c.req.header("cookie"));
    return session
      ? c.json({
          authenticated: true as const,
          username: session.username,
          expiresAt: session.expiresAt,
        })
      : c.json({ authenticated: false as const });
  });

  app.post("/api/logout", async (c) => {
    try {
      await config.gmailImapReader?.closeAllSessions();
    } catch (error) {
      logError("mail.sessions.close.error", { error: errorMessage(error) });
    }

    c.header("set-cookie", sessionCookie("", config.secureCookies, true));
    return c.body(null, 204);
  });

  app.get("/api/mail-accounts", (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    return c.json({
      mailAccounts: config.mailAccounts.map(({ id, emailAddress }) => ({ id, emailAddress })),
      reader: config.reader ?? { readDwellSeconds: 3 },
    });
  });

  app.post("/api/mail-accounts/:accountId/open", async (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const accountId = c.req.param("accountId");
    const account = config.mailAccounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      return c.json({ error: "Mail account not found" }, 404);
    }
    if (!config.gmailImapReader) {
      return c.json({ error: "Live IMAP access is not configured" }, 503);
    }

    try {
      return c.json(await config.gmailImapReader.openAccount(account));
    } catch (error) {
      logError("mail.account.open.error", { accountId, error: errorMessage(error) });
      return c.json({ error: "Mail account unavailable", accountId }, 502);
    }
  });

  app.post("/api/mail-accounts/:accountId/refresh", async (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const accountId = c.req.param("accountId");
    const account = config.mailAccounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      return c.json({ error: "Mail account not found" }, 404);
    }
    if (!config.gmailImapReader) {
      return c.json({ error: "Live IMAP access is not configured" }, 503);
    }

    try {
      return c.json(await config.gmailImapReader.refreshAccount(account, await c.req.json()));
    } catch (error) {
      logError("mail.refresh.error", { accountId, error: errorMessage(error) });
      return c.json({ error: "Mail account unavailable", accountId }, 502);
    }
  });

  app.get("/api/mail-accounts/:accountId/mailboxes/:mailboxId/messages", async (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const accountId = c.req.param("accountId");
    const account = config.mailAccounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      return c.json({ error: "Mail account not found" }, 404);
    }
    if (!config.gmailImapReader) {
      return c.json({ error: "Live IMAP access is not configured" }, 503);
    }

    try {
      return c.json(
        await config.gmailImapReader.listMailbox(
          account,
          c.req.param("mailboxId"),
          c.req.query("cursor"),
        ),
      );
    } catch (error) {
      logError("mail.mailbox.list.error", { accountId, error: errorMessage(error) });
      return c.json({ error: "Messages unavailable", accountId }, 502);
    }
  });

  app.get("/api/mail-accounts/:accountId/messages/unread", async (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const accountId = c.req.param("accountId");
    const account = config.mailAccounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      return c.json({ error: "Mail account not found" }, 404);
    }
    if (!config.gmailImapReader) {
      return c.json({ error: "Live IMAP access is not configured" }, 503);
    }

    try {
      return c.json(await config.gmailImapReader.listUnread(account, c.req.query("cursor")));
    } catch (error) {
      logError("mail.unread.list.error", { accountId, error: errorMessage(error) });
      return c.json({ error: "Messages unavailable", accountId }, 502);
    }
  });

  app.get("/api/mail-accounts/:accountId/messages/search", async (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const accountId = c.req.param("accountId");
    const account = config.mailAccounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      return c.json({ error: "Mail account not found" }, 404);
    }
    const query = c.req.query("q");
    if (!query?.trim()) {
      return c.json({ error: "Search query is required" }, 400);
    }
    if (!config.gmailImapReader) {
      return c.json({ error: "Live IMAP access is not configured" }, 503);
    }

    try {
      const page = await config.gmailImapReader.search(account, query, c.req.query("cursor"));
      c.header("cache-control", "no-store");
      return c.json(page);
    } catch {
      logError("mail.search.error", { accountId });
      return c.json({ error: "Search unavailable", accountId }, 502);
    }
  });

  app.get("/api/mail-accounts/:accountId/messages/:messageId", async (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const accountId = c.req.param("accountId");
    const account = config.mailAccounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      return c.json({ error: "Mail account not found" }, 404);
    }
    if (!config.gmailImapReader) {
      return c.json({ error: "Live IMAP access is not configured" }, 503);
    }

    try {
      const message = await config.gmailImapReader.readMessage(account, c.req.param("messageId"));
      c.header("cache-control", "no-store");
      return message ? c.json({ message }) : c.json({ error: "Message not found" }, 404);
    } catch (error) {
      logError("mail.message.read.error", { accountId, error: errorMessage(error) });
      return c.json({ error: "Message unavailable", accountId }, 502);
    }
  });

  app.get(
    "/api/mail-accounts/:accountId/messages/:messageId/inline-resources/:resourceId",
    async (c) => {
      if (!isAuthenticated(c.req.header("cookie"))) {
        return c.json({ error: "Authentication required" }, 401);
      }

      const accountId = c.req.param("accountId");
      const account = config.mailAccounts.find((candidate) => candidate.id === accountId);
      if (!account) {
        return c.json({ error: "Mail account not found" }, 404);
      }
      if (!config.gmailImapReader) {
        return c.json({ error: "Live IMAP access is not configured" }, 503);
      }

      try {
        const resource = await config.gmailImapReader.readInlineResource(
          account,
          c.req.param("messageId"),
          c.req.param("resourceId"),
        );
        if (!resource) {
          return c.json({ error: "Inline message resource not found" }, 404);
        }

        return new Response(copyBytes(resource.bytes), {
          headers: { "content-type": resource.mimeType, "cache-control": "no-store" },
        });
      } catch (error) {
        logError("mail.inline-resource.read.error", { accountId, error: errorMessage(error) });
        return c.json({ error: "Inline message resource unavailable" }, 502);
      }
    },
  );

  app.get(
    "/api/mail-accounts/:accountId/messages/:messageId/attachments/:attachmentId",
    async (c) => {
      if (!isAuthenticated(c.req.header("cookie"))) {
        return c.json({ error: "Authentication required" }, 401);
      }

      const accountId = c.req.param("accountId");
      const account = config.mailAccounts.find((candidate) => candidate.id === accountId);
      if (!account) {
        return c.json({ error: "Mail account not found" }, 404);
      }
      if (!config.gmailImapReader) {
        return c.json({ error: "Live IMAP access is not configured" }, 503);
      }

      try {
        const attachment = await config.gmailImapReader.downloadAttachment(
          account,
          c.req.param("messageId"),
          c.req.param("attachmentId"),
        );
        if (!attachment) {
          return c.json({ error: "Attachment not found" }, 404);
        }

        return new Response(attachment.body, {
          headers: {
            "content-type": attachment.mimeType,
            "content-disposition": attachmentDisposition(attachment.filename),
            "cache-control": "no-store",
          },
        });
      } catch (error) {
        logError("mail.attachment.download.error", { accountId, error: errorMessage(error) });
        return c.json({ error: "Attachment download failed" }, 502);
      }
    },
  );

  app.post("/api/mail-accounts/:accountId/messages/:messageId/actions", async (c) => {
    if (!isAuthenticated(c.req.header("cookie"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const accountId = c.req.param("accountId");
    const messageId = c.req.param("messageId");
    const body = await c.req.json<{ action: string }>();
    if (!isMailboxAction(body.action)) {
      return c.json({ error: "Unsupported Mailbox action" }, 400);
    }

    const account = config.mailAccounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      return c.json({ error: "Mail account not found" }, 404);
    }
    if (!config.gmailImapReader) {
      return c.json({ error: "Live IMAP access is not configured" }, 503);
    }

    logInfo("mailbox.action.start", { accountId, messageId, action: body.action });
    try {
      const confirmation = await config.gmailImapReader.performMailboxAction(
        account,
        messageId,
        body.action,
      );
      logInfo("mailbox.action.finish", { accountId, messageId, action: body.action });
      return c.json(confirmation);
    } catch (error) {
      logError("mailbox.action.gmail.error", {
        accountId,
        messageId,
        action: body.action,
        error: errorMessage(error),
      });
      return c.json(
        {
          error:
            "Gmail did not confirm the Mailbox action. Refresh to verify or safely repeat the same target-state action.",
        },
        502,
      );
    }
  });

  return app;
}

export const app = createApp({
  appLogin: {
    username: "test",
    password: "test",
    sessionSecret: "test-session-secret",
  },
  reader: {
    readDwellSeconds: 3,
  },
  mailAccounts: [],
});

type AppSession = {
  username: string;
  expiresAt: string;
};

function signSessionToken(session: AppSession, secret: string): string {
  const encodedHeader = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const encodedPayload = base64UrlEncode(JSON.stringify(session));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  return `${unsignedToken}.${sign(unsignedToken, secret)}`;
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

  if (
    typeof parsed.username !== "string" ||
    typeof parsed.expiresAt !== "string" ||
    Date.parse(parsed.expiresAt) <= Date.now()
  ) {
    return undefined;
  }
  return { username: parsed.username, expiresAt: parsed.expiresAt };
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

function isMailboxAction(action: string): action is MailboxAction {
  return ["markRead", "markUnread", "archive", "delete", "star", "unstar"].includes(action);
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return body;
}

function attachmentDisposition(filename: string): string {
  return `attachment; filename="${filename.replaceAll(/[\r\n"]/g, "_")}"`;
}

function sessionCookie(value: string, secure = false, clear = false): string {
  return [
    `${sessionCookieName}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    ...(secure ? ["Secure"] : []),
    ...(clear ? ["Max-Age=0"] : []),
  ].join("; ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
