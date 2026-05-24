import { describe, expect, it } from "vite-plus/test";
import { createApp } from "../apps/api/src/app";
import type { ConfiguredMailAccount } from "../apps/api/src/config";
import { createHybridPersistence } from "../apps/api/src/persistence";
import type { MailboxActionClient } from "../apps/api/src/mailbox-actions";
import { performMailboxAction } from "../apps/web/src/api";

describe("MVP Mailbox actions", () => {
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
      { action: "markRead", accountId: "personal", messageId: "message-1" },
      { action: "markUnread", accountId: "personal", messageId: "message-1" },
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
    expect(actions).toEqual([{ action: "archive", accountId: "personal", messageId: "message-1" }]);
    expect(persistence.mailDatabaseFor("personal").getMessage("message-1")).toMatchObject({
      id: "message-1",
    });
    expect(persistence.mailDatabaseFor("personal").listMessagesForMailbox("inbox").messages).toEqual([]);
  });

  it("deletes by moving the Message to Trash without permanently deleting it", async () => {
    const { app, cookie, persistence, actions } = await createActionFixture();

    const response = await app.request("/api/mail-accounts/personal/messages/message-1/actions", {
      method: "POST",
      body: JSON.stringify({ action: "delete" }),
      headers: { cookie, "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(actions).toEqual([{ action: "delete", accountId: "personal", messageId: "message-1" }]);
    expect(persistence.mailDatabaseFor("personal").getMessage("message-1")).toMatchObject({
      id: "message-1",
    });
    expect(persistence.mailDatabaseFor("personal").listMessagesForMailbox("trash").messages).toEqual([
      expect.objectContaining({
        id: "message-1",
        mailboxIds: ["trash"],
      }),
    ]);
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
      { action: "star", accountId: "personal", messageId: "message-1" },
      { action: "unstar", accountId: "personal", messageId: "message-1" },
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
