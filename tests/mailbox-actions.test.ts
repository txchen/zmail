import { describe, expect, it } from "vite-plus/test";
import { createApp } from "../apps/api/src/app";
import type { ConfiguredMailAccount } from "../apps/api/src/config";
import { createHybridPersistence } from "../apps/api/src/persistence";
import type { MailboxActionClient } from "../apps/api/src/mailbox-actions";
import { performMailboxAction } from "../apps/web/src/api";

describe("MVP Mailbox actions", () => {
  it("marks a Message read locally when Gmail mailbox actions are not configured", async () => {
    const account: ConfiguredMailAccount = {
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "personal-app-password",
    };
    const persistence = createHybridPersistence();
    const mailDatabase = persistence.mailDatabaseFor("personal");
    mailDatabase.saveMailbox({ id: "inbox", name: "Inbox", unreadCount: 1 });
    mailDatabase.saveMessage({
      id: "message-1",
      stableIdentity: "gmail:personal:message-1",
      subject: "Actionable Message",
      receivedAt: "2026-05-23T10:00:00.000Z",
      unread: true,
      starred: false,
      aiProcessed: false,
      readableBody: "<p>Hello</p>",
      attachments: [],
    });
    mailDatabase.saveMailboxEntry({
      id: "message-1:inbox",
      mailboxId: "inbox",
      messageId: "message-1",
    });
    const app = createApp({
      appLogin: { username: "reader", password: "secret", sessionSecret: "test-session-secret" },
      mailAccounts: [account],
      persistence,
    });
    const loginResponse = await app.request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "reader", password: "secret" }),
      headers: { "content-type": "application/json" },
    });

    const response = await app.request("/api/mail-accounts/personal/messages/message-1/actions", {
      method: "POST",
      body: JSON.stringify({ action: "markRead" }),
      headers: {
        cookie: loginResponse.headers.get("set-cookie") ?? "",
        "content-type": "application/json",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      message: {
        id: "message-1",
        unread: false,
      },
    });
    expect(mailDatabase.getMessage("personal", "message-1")).toMatchObject({
      unread: false,
    });
    expect(mailDatabase.listMailboxes()).toEqual([
      expect.objectContaining({
        id: "inbox",
        unreadCount: 0,
      }),
    ]);
  });

  it("marks a Message read and unread through Gmail before updating local unread state", async () => {
    const { app, cookie, actions } = await createActionFixture();

    const readResponse = await app.request(
      "/api/mail-accounts/personal/messages/message-1/actions",
      {
        method: "POST",
        body: JSON.stringify({ action: "markRead" }),
        headers: { cookie, "content-type": "application/json" },
      },
    );
    expect(readResponse.status).toBe(200);
    expect(await readResponse.json()).toMatchObject({
      message: {
        id: "message-1",
        unread: false,
      },
    });

    const unreadResponse = await app.request(
      "/api/mail-accounts/personal/messages/message-1/actions",
      {
        method: "POST",
        body: JSON.stringify({ action: "markUnread" }),
        headers: { cookie, "content-type": "application/json" },
      },
    );
    expect(unreadResponse.status).toBe(200);
    expect(await unreadResponse.json()).toMatchObject({
      message: {
        id: "message-1",
        unread: true,
      },
    });
    expect(actions).toEqual([
      expect.objectContaining({
        action: "markRead",
        accountId: "personal",
        messageId: "message-1",
      }),
      expect.objectContaining({
        action: "markUnread",
        accountId: "personal",
        messageId: "message-1",
      }),
    ]);
  });

  it("returns a clear error and leaves local state unchanged when Gmail rejects an action", async () => {
    const { app, cookie, persistence } = await createActionFixture({
      async markRead() {
        throw new Error("Gmail rejected mark read");
      },
    });

    const response = await app.request("/api/mail-accounts/personal/messages/message-1/actions", {
      method: "POST",
      body: JSON.stringify({ action: "markRead" }),
      headers: { cookie, "content-type": "application/json" },
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Mailbox action failed" });
    expect(persistence.mailDatabaseFor("personal").getMessage("message-1")).toMatchObject({
      id: "message-1",
      unread: true,
    });
  });

  it("archives by removing the Inbox entry while keeping the Message in the Mail account", async () => {
    const { app, cookie, persistence, actions } = await createActionFixture();

    const response = await app.request("/api/mail-accounts/personal/messages/message-1/actions", {
      method: "POST",
      body: JSON.stringify({ action: "archive" }),
      headers: { cookie, "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(actions).toEqual([
      expect.objectContaining({ action: "archive", accountId: "personal", messageId: "message-1" }),
    ]);
    expect(persistence.mailDatabaseFor("personal").getMessage("message-1")).toMatchObject({
      id: "message-1",
    });
    expect(
      persistence.mailDatabaseFor("personal").listMessagesForMailbox("inbox").messages,
    ).toEqual([]);
  });

  it("deletes by moving the Message to Trash without permanently deleting it", async () => {
    const { app, cookie, persistence, actions } = await createActionFixture();

    const response = await app.request("/api/mail-accounts/personal/messages/message-1/actions", {
      method: "POST",
      body: JSON.stringify({ action: "delete" }),
      headers: { cookie, "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(actions).toEqual([
      expect.objectContaining({ action: "delete", accountId: "personal", messageId: "message-1" }),
    ]);
    expect(persistence.mailDatabaseFor("personal").getMessage("message-1")).toMatchObject({
      id: "message-1",
    });
    expect(
      persistence.mailDatabaseFor("personal").listMessagesForMailbox("trash").messages,
    ).toEqual([
      expect.objectContaining({
        id: "message-1",
        mailboxIds: ["trash"],
      }),
    ]);
  });

  it("deletes into the configured Gmail Trash mailbox when it is not named trash", async () => {
    const { app, cookie, persistence, actions } = await createActionFixture({
      async delete(target) {
        actions.push({ action: "delete", ...target });
      },
    });
    const mailDatabase = persistence.mailDatabaseFor("personal");
    mailDatabase.removeMailboxEntry("message-1", "inbox");
    mailDatabase.removeMailboxEntry("message-1", "trash");
    mailDatabase.saveMailbox({ id: "inbox", name: "Inbox", unreadCount: 0 });
    mailDatabase.saveMailbox({ id: "INBOX/Project", name: "INBOX/Project", unreadCount: 0 });
    mailDatabase.saveMailbox({ id: "[Gmail]/All Mail", name: "[Gmail]/All Mail", unreadCount: 0 });
    mailDatabase.saveMailbox({ id: "[Gmail]/Trash", name: "[Gmail]/Trash", unreadCount: 0 });
    mailDatabase.saveMailboxEntry({
      id: "message-1:inbox",
      mailboxId: "inbox",
      messageId: "message-1",
    });
    mailDatabase.saveMailboxEntry({
      id: "message-1:INBOX/Project",
      mailboxId: "INBOX/Project",
      messageId: "message-1",
    });
    mailDatabase.saveMailboxEntry({
      id: "message-1:[Gmail]/All Mail",
      mailboxId: "[Gmail]/All Mail",
      messageId: "message-1",
    });

    const response = await app.request("/api/mail-accounts/personal/messages/message-1/actions", {
      method: "POST",
      body: JSON.stringify({ action: "delete" }),
      headers: { cookie, "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(actions).toEqual([
      expect.objectContaining({ action: "delete", accountId: "personal", messageId: "message-1" }),
    ]);
    expect(
      persistence.mailDatabaseFor("personal").listMessagesForMailbox("[Gmail]/Trash").messages,
    ).toEqual([
      expect.objectContaining({
        id: "message-1",
        mailboxIds: ["[Gmail]/Trash"],
      }),
    ]);
    const unreadResponse = await app.request("/api/mail-accounts/personal/messages/unread", {
      headers: { cookie },
    });
    expect(await unreadResponse.json()).toMatchObject({ messages: [] });
    expect(mailDatabase.listMailboxes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "inbox", unreadCount: 0 }),
        expect.objectContaining({ id: "INBOX/Project", unreadCount: 0 }),
        expect.objectContaining({ id: "[Gmail]/All Mail", unreadCount: 0 }),
        expect.objectContaining({ id: "[Gmail]/Trash", unreadCount: 1 }),
      ]),
    );
  });

  it("stars and unstars a Message through Gmail before updating local state", async () => {
    const { app, cookie, actions } = await createActionFixture();

    const starResponse = await app.request(
      "/api/mail-accounts/personal/messages/message-1/actions",
      {
        method: "POST",
        body: JSON.stringify({ action: "star" }),
        headers: { cookie, "content-type": "application/json" },
      },
    );
    expect(starResponse.status).toBe(200);
    expect(await starResponse.json()).toMatchObject({
      message: {
        id: "message-1",
        starred: true,
      },
    });

    const unstarResponse = await app.request(
      "/api/mail-accounts/personal/messages/message-1/actions",
      {
        method: "POST",
        body: JSON.stringify({ action: "unstar" }),
        headers: { cookie, "content-type": "application/json" },
      },
    );
    expect(unstarResponse.status).toBe(200);
    expect(await unstarResponse.json()).toMatchObject({
      message: {
        id: "message-1",
        starred: false,
      },
    });
    expect(actions).toEqual([
      expect.objectContaining({ action: "star", accountId: "personal", messageId: "message-1" }),
      expect.objectContaining({ action: "unstar", accountId: "personal", messageId: "message-1" }),
    ]);
  });

  it("lets the web app perform each MVP Mailbox action through the API route", async () => {
    const requests: Array<{ path: string | URL | Request; init: RequestInit | undefined }> = [];
    const fetcher = async (path: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests.push({ path, init });

      return Response.json({
        message: {
          id: "message-1",
          stableIdentity: "gmail:personal:message-1",
          subject: "Actionable Message",
          receivedAt: "2026-05-23T10:00:00.000Z",
          unread: false,
          starred: true,
          readableBody: "<p>Hello</p>",
          attachments: [],
        },
      });
    };

    await performMailboxAction("personal", "message-1", "markRead", fetcher);
    await performMailboxAction("personal", "message-1", "markUnread", fetcher);
    await performMailboxAction("personal", "message-1", "archive", fetcher);
    await performMailboxAction("personal", "message-1", "delete", fetcher);
    await performMailboxAction("personal", "message-1", "star", fetcher);
    await performMailboxAction("personal", "message-1", "unstar", fetcher);

    expect(requests.map((request) => request.path)).toEqual([
      "/api/mail-accounts/personal/messages/message-1/actions",
      "/api/mail-accounts/personal/messages/message-1/actions",
      "/api/mail-accounts/personal/messages/message-1/actions",
      "/api/mail-accounts/personal/messages/message-1/actions",
      "/api/mail-accounts/personal/messages/message-1/actions",
      "/api/mail-accounts/personal/messages/message-1/actions",
    ]);
    expect(requests.map((request) => JSON.parse(String(request.init?.body)))).toEqual([
      { action: "markRead" },
      { action: "markUnread" },
      { action: "archive" },
      { action: "delete" },
      { action: "star" },
      { action: "unstar" },
    ]);
  });

  it("performs bulk Mailbox actions with partial-success results", async () => {
    const { app, cookie, persistence, actions } = await createActionFixture({
      async archive(target) {
        actions.push({ action: "archive", ...target });
        if (target.messageId === "message-2") {
          throw new Error("Gmail rejected archive");
        }
      },
    });
    const mailDatabase = persistence.mailDatabaseFor("personal");
    mailDatabase.saveMessage({
      id: "message-2",
      stableIdentity: "gmail:personal:message-2",
      subject: "Second",
      receivedAt: "2026-05-23T11:00:00.000Z",
      unread: true,
      starred: false,
      aiProcessed: false,
      readableBody: "",
      attachments: [],
    });
    mailDatabase.saveMailboxEntry({
      id: "message-2:inbox",
      mailboxId: "inbox",
      messageId: "message-2",
    });

    expect((await app.request("/api/mail-accounts/personal/messages/actions")).status).toBe(401);

    for (const action of ["markRead", "markUnread", "star", "unstar", "delete"] as const) {
      const response = await app.request("/api/mail-accounts/personal/messages/actions", {
        method: "POST",
        body: JSON.stringify({ action, messageIds: ["message-1"] }),
        headers: { cookie, "content-type": "application/json" },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ succeededIds: ["message-1"], failed: [] });
    }

    const partialResponse = await app.request("/api/mail-accounts/personal/messages/actions", {
      method: "POST",
      body: JSON.stringify({
        action: "archive",
        messageIds: ["message-1", "message-2", "unknown"],
      }),
      headers: { cookie, "content-type": "application/json" },
    });
    expect(partialResponse.status).toBe(200);
    expect(await partialResponse.json()).toEqual({
      succeededIds: ["message-1"],
      failed: [
        { id: "message-2", error: "Mailbox action failed" },
        { id: "unknown", error: "Message not found" },
      ],
    });
    expect(mailDatabase.getMessage("message-1")).toMatchObject({ unread: true, starred: false });
    expect(
      mailDatabase.listMessagesForMailbox("inbox").messages.map((message) => message.id),
    ).toEqual(["message-2"]);

    for (const action of ["label", "moveToMailbox"]) {
      const response = await app.request("/api/mail-accounts/personal/messages/actions", {
        method: "POST",
        body: JSON.stringify({ action, messageIds: ["message-1"] }),
        headers: { cookie, "content-type": "application/json" },
      });
      expect(response.status).toBe(400);
    }
  });
});

async function createActionFixture(overrides: Partial<MailboxActionClient> = {}) {
  const account: ConfiguredMailAccount = {
    id: "personal",
    emailAddress: "me@example.com",
    appPassword: "personal-app-password",
  };
  const persistence = createHybridPersistence();
  const mailDatabase = persistence.mailDatabaseFor("personal");
  const actions: Array<{ action: string; accountId: string; messageId: string }> = [];
  const actionClient: MailboxActionClient = {
    async markRead(target) {
      actions.push({ action: "markRead", ...target });
    },
    async markUnread(target) {
      actions.push({ action: "markUnread", ...target });
    },
    async archive(target) {
      actions.push({ action: "archive", ...target });
    },
    async delete(target) {
      actions.push({ action: "delete", ...target });
    },
    async star(target) {
      actions.push({ action: "star", ...target });
    },
    async unstar(target) {
      actions.push({ action: "unstar", ...target });
    },
    ...overrides,
  };

  mailDatabase.saveMailbox({ id: "inbox", name: "Inbox", unreadCount: 1 });
  mailDatabase.saveMailbox({ id: "trash", name: "[Gmail]/Trash", unreadCount: 0 });
  mailDatabase.saveMessage({
    id: "message-1",
    stableIdentity: "gmail:personal:message-1",
    subject: "Actionable Message",
    receivedAt: "2026-05-23T10:00:00.000Z",
    unread: true,
    starred: false,
    aiProcessed: false,
    readableBody: "<p>Hello</p>",
    attachments: [],
  });
  mailDatabase.saveMailboxEntry({
    id: "message-1:inbox",
    mailboxId: "inbox",
    messageId: "message-1",
  });

  const app = createApp({
    appLogin: { username: "reader", password: "secret", sessionSecret: "test-session-secret" },
    mailAccounts: [account],
    persistence,
    mailboxActionClient: actionClient,
  });
  const loginResponse = await app.request("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: "reader", password: "secret" }),
    headers: { "content-type": "application/json" },
  });

  return {
    actions,
    app,
    cookie: loginResponse.headers.get("set-cookie") ?? "",
    persistence,
  };
}
