import { describe, expect, it } from "vite-plus/test";
import { createApp } from "../apps/api/src/app";
import type { ConfiguredMailAccount } from "../apps/api/src/config";
import { createHybridPersistence } from "../apps/api/src/persistence";
import type { MessageSyncClient } from "../apps/api/src/sync";
import { syncRecentMessages } from "../apps/api/src/sync";
import {
  fetchMessagesForMailbox,
  fetchUnreadMessagesForAccount,
  searchMessagesForAccount,
} from "../apps/web/src/api";

describe("recent Message sync", () => {
  it("applies the default Sync window and stores one Message with multiple Mailbox entries", async () => {
    const persistence = createHybridPersistence();
    const account: ConfiguredMailAccount = {
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "personal-app-password",
    };
    const now = new Date("2026-05-24T12:00:00.000Z");
    const client: MessageSyncClient = {
      async listRecentMessages(request) {
        expect(request.account.appPassword).toBe("personal-app-password");
        expect(request.since).toEqual(new Date("2026-02-23T12:00:00.000Z"));

        return [
          {
            id: "message-1",
            stableIdentity: "gmail:personal:message-1",
            subject: "Recent readable Message",
            receivedAt: "2026-05-23T10:00:00.000Z",
            unread: true,
            readableBody: "<p>Hello</p>",
            attachments: [
              {
                id: "attachment-1",
                filename: "agenda.pdf",
                mimeType: "application/pdf",
                sizeBytes: 42,
                bytes: "not stored",
              },
            ],
            mailboxIds: ["inbox", "all-mail"],
          },
          {
            id: "message-old",
            stableIdentity: "gmail:personal:message-old",
            subject: "Old Message",
            receivedAt: "2026-01-01T10:00:00.000Z",
            unread: false,
            readableBody: "Too old",
            attachments: [],
            mailboxIds: ["inbox"],
          },
        ];
      },
    };
    const mailDatabase = persistence.mailDatabaseFor("personal");
    mailDatabase.saveMailbox({ id: "inbox", name: "Inbox", unreadCount: 1 });
    mailDatabase.saveMailbox({ id: "all-mail", name: "All Mail", unreadCount: 1 });

    await syncRecentMessages({
      accounts: [account],
      persistence,
      client,
      now,
    });

    expect(mailDatabase.listMessagesWithMailboxEntries()).toEqual([
      {
        id: "message-1",
        stableIdentity: "gmail:personal:message-1",
        subject: "Recent readable Message",
        receivedAt: "2026-05-23T10:00:00.000Z",
        unread: true,
        starred: false,
        aiProcessed: false,
        readableBody: "<p>Hello</p>",
        attachments: [
          {
            id: "attachment-1",
            filename: "agenda.pdf",
            mimeType: "application/pdf",
            sizeBytes: 42,
          },
        ],
        mailboxEntries: [
          { id: "message-1:inbox", mailboxId: "inbox", mailboxName: "Inbox" },
          { id: "message-1:all-mail", mailboxId: "all-mail", mailboxName: "All Mail" },
        ],
      },
    ]);
  });

  it("exposes Messages for a selected Mailbox and returns metadata with readable body", async () => {
    const persistence = createHybridPersistence();
    const account: ConfiguredMailAccount = {
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "personal-app-password",
    };
    const mailDatabase = persistence.mailDatabaseFor("personal");
    mailDatabase.saveMailbox({ id: "inbox", name: "Inbox", unreadCount: 1 });
    mailDatabase.saveMessage({
      id: "message-1",
      stableIdentity: "gmail:personal:message-1",
      threadId: "thread-1",
      subject: "Readable Message",
      sender: { address: "sender@example.com", displayName: "Sender" },
      recipients: [{ address: "reader@example.com" }],
      receivedAt: "2026-05-23T10:00:00.000Z",
      unread: true,
      starred: false,
      aiProcessed: false,
      snippet: "Hello from the readable Message",
      readableBody: "<p>Hello</p>",
      plainTextBody: "Hello",
      blockedRemoteImageCount: 2,
      updatedAt: "2026-05-23T10:05:00.000Z",
      attachments: [
        {
          id: "attachment-1",
          filename: "agenda.pdf",
          mimeType: "application/pdf",
          sizeBytes: 42,
        },
      ],
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
    const cookie = loginResponse.headers.get("set-cookie") ?? "";

    const listResponse = await app.request("/api/mail-accounts/personal/mailboxes/inbox/messages", {
      headers: { cookie },
    });
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual({
      messages: [
        {
          id: "message-1",
          accountId: "personal",
          stableIdentity: "gmail:personal:message-1",
          threadId: "thread-1",
          subject: "Readable Message",
          sender: { address: "sender@example.com", displayName: "Sender" },
          recipients: [{ address: "reader@example.com" }],
          receivedAt: "2026-05-23T10:00:00.000Z",
          unread: true,
          starred: false,
          mailboxIds: ["inbox"],
          snippet: "Hello from the readable Message",
          attachmentCount: 1,
          updatedAt: "2026-05-23T10:05:00.000Z",
        },
      ],
    });

    const messageResponse = await app.request("/api/mail-accounts/personal/messages/message-1", {
      headers: { cookie },
    });
    expect(messageResponse.status).toBe(200);
    expect(await messageResponse.json()).toEqual({
      message: {
        id: "message-1",
        accountId: "personal",
        stableIdentity: "gmail:personal:message-1",
        threadId: "thread-1",
        subject: "Readable Message",
        sender: { address: "sender@example.com", displayName: "Sender" },
        recipients: [{ address: "reader@example.com" }],
        receivedAt: "2026-05-23T10:00:00.000Z",
        unread: true,
        starred: false,
        mailboxIds: ["inbox"],
        snippet: "Hello from the readable Message",
        attachmentCount: 1,
        updatedAt: "2026-05-23T10:05:00.000Z",
        readableBody: "<p>Hello</p>",
        plainTextBody: "Hello",
        blockedRemoteImageCount: 2,
        attachments: [
          {
            id: "attachment-1",
            filename: "agenda.pdf",
            mimeType: "application/pdf",
            sizeBytes: 42,
          },
        ],
      },
    });
  });

  it("paginates and filters Messages in a Mailbox by common Message filters", async () => {
    const persistence = createHybridPersistence();
    const account: ConfiguredMailAccount = {
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "personal-app-password",
    };
    const mailDatabase = persistence.mailDatabaseFor("personal");
    mailDatabase.saveMailbox({ id: "inbox", name: "Inbox", unreadCount: 2 });

    for (const message of [
      {
        id: "message-3",
        receivedAt: "2026-05-23T12:00:00.000Z",
        unread: true,
        starred: true,
        sender: { address: "alerts@example.com" },
        attachments: [{ id: "a1", filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 1 }],
      },
      {
        id: "message-2",
        receivedAt: "2026-05-23T11:00:00.000Z",
        unread: false,
        starred: true,
        sender: { address: "friend@example.com" },
        attachments: [],
      },
      {
        id: "message-1",
        receivedAt: "2026-05-22T10:00:00.000Z",
        unread: true,
        starred: false,
        sender: { address: "alerts@example.com" },
        attachments: [],
      },
    ]) {
      mailDatabase.saveMessage({
        ...message,
        stableIdentity: `gmail:personal:${message.id}`,
        subject: message.id,
        recipients: [],
        aiProcessed: false,
        readableBody: "",
      });
      mailDatabase.saveMailboxEntry({
        id: `${message.id}:inbox`,
        mailboxId: "inbox",
        messageId: message.id,
      });
    }

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
    const cookie = loginResponse.headers.get("set-cookie") ?? "";

    const firstPage = await app.request(
      "/api/mail-accounts/personal/mailboxes/inbox/messages?limit=2",
      { headers: { cookie } },
    );
    expect(firstPage.status).toBe(200);
    const firstPageBody = await firstPage.json();
    expect(firstPageBody.messages.map((message: { id: string }) => message.id)).toEqual([
      "message-3",
      "message-2",
    ]);
    expect(firstPageBody.nextCursor).toEqual(expect.any(String));

    const secondPage = await app.request(
      `/api/mail-accounts/personal/mailboxes/inbox/messages?cursor=${encodeURIComponent(firstPageBody.nextCursor)}`,
      { headers: { cookie } },
    );
    expect((await secondPage.json()).messages.map((message: { id: string }) => message.id)).toEqual(
      ["message-1"],
    );

    const filtered = await app.request(
      "/api/mail-accounts/personal/mailboxes/inbox/messages?unread=true&starred=true&hasAttachments=true&from=alerts@example.com&after=2026-05-23T00:00:00.000Z&before=2026-05-24T00:00:00.000Z",
      { headers: { cookie } },
    );
    expect((await filtered.json()).messages.map((message: { id: string }) => message.id)).toEqual([
      "message-3",
    ]);

    const invalidCursor = await app.request(
      "/api/mail-accounts/personal/mailboxes/inbox/messages?cursor=not-a-cursor",
      { headers: { cookie } },
    );
    expect(invalidCursor.status).toBe(400);
  });

  it("returns a paginated per-account unread view without cross-account UI unread", async () => {
    const persistence = createHybridPersistence();
    const account: ConfiguredMailAccount = {
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "personal-app-password",
    };
    const mailDatabase = persistence.mailDatabaseFor("personal");
    mailDatabase.saveMailbox({ id: "inbox", name: "Inbox", unreadCount: 2 });
    mailDatabase.saveMailbox({ id: "all-mail", name: "All Mail", unreadCount: 2 });

    for (const message of [
      {
        id: "message-2",
        receivedAt: "2026-05-23T12:00:00.000Z",
        unread: true,
        starred: true,
        sender: { address: "alerts@example.com" },
      },
      {
        id: "message-1",
        receivedAt: "2026-05-23T11:00:00.000Z",
        unread: true,
        starred: false,
        sender: { address: "friend@example.com" },
      },
      {
        id: "message-read",
        receivedAt: "2026-05-23T10:00:00.000Z",
        unread: false,
        starred: true,
        sender: { address: "alerts@example.com" },
      },
    ]) {
      mailDatabase.saveMessage({
        ...message,
        stableIdentity: `gmail:personal:${message.id}`,
        subject: message.id,
        recipients: [],
        aiProcessed: false,
        readableBody: "",
        attachments: [],
      });
      for (const mailboxId of ["inbox", "all-mail"]) {
        mailDatabase.saveMailboxEntry({
          id: `${message.id}:${mailboxId}`,
          mailboxId,
          messageId: message.id,
        });
      }
    }

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
    const cookie = loginResponse.headers.get("set-cookie") ?? "";

    expect((await app.request("/api/mail-accounts/personal/messages/unread")).status).toBe(401);
    expect((await app.request("/api/messages/unread", { headers: { cookie } })).status).toBe(404);
    expect(
      (await app.request("/api/mail-accounts/unknown/messages/unread", { headers: { cookie } }))
        .status,
    ).toBe(404);

    const firstPage = await app.request("/api/mail-accounts/personal/messages/unread?limit=1", {
      headers: { cookie },
    });
    const firstPageBody = await firstPage.json();
    expect(firstPageBody.messages.map((message: { id: string }) => message.id)).toEqual([
      "message-2",
    ]);
    expect(firstPageBody.messages[0].mailboxIds).toEqual(["all-mail", "inbox"]);
    expect(firstPageBody.nextCursor).toEqual(expect.any(String));

    const filtered = await app.request(
      "/api/mail-accounts/personal/messages/unread?starred=true&from=alerts@example.com",
      { headers: { cookie } },
    );
    expect((await filtered.json()).messages.map((message: { id: string }) => message.id)).toEqual([
      "message-2",
    ]);
  });

  it("searches one Mail account from the Local read model with pagination and filters", async () => {
    const persistence = createHybridPersistence();
    const account: ConfiguredMailAccount = {
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "personal-app-password",
    };
    const mailDatabase = persistence.mailDatabaseFor("personal");
    mailDatabase.saveMailbox({ id: "inbox", name: "Inbox", unreadCount: 1 });

    for (const message of [
      {
        id: "message-2",
        subject: "Quarterly plan",
        readableBody: "Launch checklist",
        receivedAt: "2026-05-23T12:00:00.000Z",
        unread: true,
        starred: true,
        sender: { address: "alerts@example.com" },
      },
      {
        id: "message-1",
        subject: "Status",
        readableBody: "Quarterly body match",
        receivedAt: "2026-05-23T11:00:00.000Z",
        unread: true,
        starred: false,
        sender: { address: "friend@example.com" },
      },
    ]) {
      mailDatabase.saveMessage({
        ...message,
        stableIdentity: `gmail:personal:${message.id}`,
        recipients: [],
        aiProcessed: false,
        attachments: [],
      });
      mailDatabase.saveMailboxEntry({
        id: `${message.id}:inbox`,
        mailboxId: "inbox",
        messageId: message.id,
      });
    }

    const app = createApp({
      appLogin: { username: "reader", password: "secret", sessionSecret: "test-session-secret" },
      mailAccounts: [account],
      persistence,
      mailboxSyncClient: {
        async listVisibleMailboxes() {
          throw new Error("Search must not call Gmail");
        },
      },
    });
    const loginResponse = await app.request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "reader", password: "secret" }),
      headers: { "content-type": "application/json" },
    });
    const cookie = loginResponse.headers.get("set-cookie") ?? "";

    expect(
      (await app.request("/api/mail-accounts/personal/messages/search?q=quarterly")).status,
    ).toBe(401);
    expect(
      (await app.request("/api/mail-accounts/personal/messages/search", { headers: { cookie } }))
        .status,
    ).toBe(400);
    expect(
      (
        await app.request("/api/mail-accounts/unknown/messages/search?q=quarterly", {
          headers: { cookie },
        })
      ).status,
    ).toBe(404);

    const firstPage = await app.request(
      "/api/mail-accounts/personal/messages/search?q=quarterly&limit=1",
      { headers: { cookie } },
    );
    const firstPageBody = await firstPage.json();
    expect(firstPageBody.messages.map((message: { id: string }) => message.id)).toEqual([
      "message-2",
    ]);
    expect(firstPageBody.nextCursor).toEqual(expect.any(String));

    const filtered = await app.request(
      "/api/mail-accounts/personal/messages/search?q=quarterly&starred=false&from=friend@example.com",
      { headers: { cookie } },
    );
    expect((await filtered.json()).messages.map((message: { id: string }) => message.id)).toEqual([
      "message-1",
    ]);

    const noMatches = await app.request("/api/mail-accounts/personal/messages/search?q=missing", {
      headers: { cookie },
    });
    expect(await noMatches.json()).toEqual({ messages: [] });
  });

  it("downloads attachment bytes on demand after validating local attachment metadata", async () => {
    const persistence = createHybridPersistence();
    const account: ConfiguredMailAccount = {
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "personal-app-password",
    };
    const mailDatabase = persistence.mailDatabaseFor("personal");
    mailDatabase.saveMessage({
      id: "message-1",
      stableIdentity: "gmail:personal:message-1",
      subject: "Attachment Message",
      receivedAt: "2026-05-23T10:00:00.000Z",
      unread: true,
      starred: false,
      aiProcessed: false,
      readableBody: "",
      attachments: [
        {
          id: "attachment-1",
          filename: "agenda.pdf",
          mimeType: "application/pdf",
          sizeBytes: 3,
        },
      ],
    });
    const requests: Array<{ accountId: string; messageId: string; attachmentId: string }> = [];
    const app = createApp({
      appLogin: { username: "reader", password: "secret", sessionSecret: "test-session-secret" },
      mailAccounts: [account],
      persistence,
      attachmentDownloadClient: {
        async downloadAttachment(request) {
          requests.push(request);
          return new Uint8Array([1, 2, 3]);
        },
      },
    });
    const loginResponse = await app.request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "reader", password: "secret" }),
      headers: { "content-type": "application/json" },
    });
    const cookie = loginResponse.headers.get("set-cookie") ?? "";

    expect(
      (await app.request("/api/mail-accounts/personal/messages/message-1/attachments/attachment-1"))
        .status,
    ).toBe(401);

    const response = await app.request(
      "/api/mail-accounts/personal/messages/message-1/attachments/attachment-1",
      { headers: { cookie } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain('filename="agenda.pdf"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(requests).toEqual([
      { accountId: "personal", messageId: "message-1", attachmentId: "attachment-1" },
    ]);

    expect(
      (
        await app.request("/api/mail-accounts/personal/messages/message-1/attachments/unknown", {
          headers: { cookie },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request("/api/mail-accounts/personal/messages/unknown/attachments/attachment-1", {
          headers: { cookie },
        })
      ).status,
    ).toBe(404);
  });

  it("returns a useful attachment download error without exposing credentials", async () => {
    const persistence = createHybridPersistence();
    const account: ConfiguredMailAccount = {
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "secret-app-password",
    };
    persistence.mailDatabaseFor("personal").saveMessage({
      id: "message-1",
      stableIdentity: "gmail:personal:message-1",
      subject: "Attachment Message",
      receivedAt: "2026-05-23T10:00:00.000Z",
      unread: true,
      starred: false,
      aiProcessed: false,
      readableBody: "",
      attachments: [
        { id: "attachment-1", filename: "agenda.pdf", mimeType: "application/pdf", sizeBytes: 3 },
      ],
    });
    const app = createApp({
      appLogin: { username: "reader", password: "secret", sessionSecret: "test-session-secret" },
      mailAccounts: [account],
      persistence,
      attachmentDownloadClient: {
        async downloadAttachment() {
          throw new Error("Gmail rejected secret-app-password");
        },
      },
    });
    const loginResponse = await app.request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "reader", password: "secret" }),
      headers: { "content-type": "application/json" },
    });
    const response = await app.request(
      "/api/mail-accounts/personal/messages/message-1/attachments/attachment-1",
      { headers: { cookie: loginResponse.headers.get("set-cookie") ?? "" } },
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Attachment download failed" });
  });

  it("lets the web app fetch Mailbox, Account unread, and Search Message list views", async () => {
    const requests: Array<string | URL | Request> = [];
    const fetcher = async (path: string | URL | Request): Promise<Response> => {
      requests.push(path);

      return Response.json({ messages: [] });
    };

    await expect(fetchMessagesForMailbox("personal", "inbox", fetcher)).resolves.toEqual({
      messages: [],
    });
    await expect(fetchUnreadMessagesForAccount("personal", fetcher)).resolves.toEqual({
      messages: [],
    });
    await expect(
      searchMessagesForAccount("personal", "quarterly invoice", fetcher),
    ).resolves.toEqual({
      messages: [],
    });

    expect(requests).toEqual([
      "/api/mail-accounts/personal/mailboxes/inbox/messages",
      "/api/mail-accounts/personal/messages/unread",
      "/api/mail-accounts/personal/messages/search?q=quarterly%20invoice",
    ]);
  });
});
