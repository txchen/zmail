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
        expect(request.mailboxes).toEqual([
          { id: "all-mail", since: new Date("2026-02-23T12:00:00.000Z") },
          { id: "inbox", since: new Date("2026-02-23T12:00:00.000Z") },
        ]);

        return [
          {
            id: "message-1",
            stableIdentity: "gmail:personal:message-1",
            uid: 42,
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

    const result = await syncRecentMessages({
      accounts: [account],
      persistence,
      client,
      now,
    });

    expect(result).toMatchObject({
      mailboxCount: 2,
      scannedMailboxCount: 2,
      skippedMailboxCount: 0,
      fetchedMessageCount: 2,
      storedMessageCount: 1,
      removedMailboxEntryCount: 0,
      durationMs: expect.any(Number),
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
    expect(mailDatabase.getMailboxSyncState("inbox")).toEqual({
      mailboxId: "inbox",
      highestUid: 42,
      lastSyncedAt: "2026-05-24T12:00:00.000Z",
    });
    expect(mailDatabase.getMailboxSyncState("all-mail")).toEqual({
      mailboxId: "all-mail",
      highestUid: 42,
      lastSyncedAt: "2026-05-24T12:00:00.000Z",
    });
  });

  it("uses saved Mailbox checkpoints for incremental Message sync", async () => {
    const persistence = createHybridPersistence();
    const account: ConfiguredMailAccount = {
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "personal-app-password",
    };
    const mailDatabase = persistence.mailDatabaseFor("personal");
    const requests: unknown[] = [];
    const client: MessageSyncClient = {
      async listRecentMessages(request) {
        requests.push(request);

        return [
          {
            id: `message-${requests.length}`,
            stableIdentity: `gmail:personal:message-${requests.length}`,
            uid: requests.length === 1 ? 10 : 11,
            subject: "Incremental Message",
            receivedAt: "2026-05-23T10:00:00.000Z",
            unread: true,
            readableBody: "<p>Hello</p>",
            attachments: [],
            mailboxIds: ["inbox"],
          },
        ];
      },
    };
    mailDatabase.saveMailbox({ id: "inbox", name: "Inbox", unreadCount: 1 });

    const firstResult = await syncRecentMessages({
      accounts: [account],
      persistence,
      client,
      now: new Date("2026-05-24T12:00:00.000Z"),
    });
    const secondResult = await syncRecentMessages({
      accounts: [account],
      persistence,
      client,
      now: new Date("2026-05-24T12:05:00.000Z"),
    });

    expect(requests).toEqual([
      {
        account,
        mailboxes: [{ id: "inbox", since: new Date("2026-02-23T12:00:00.000Z") }],
      },
      {
        account,
        mailboxes: [{ id: "inbox", afterUid: 10 }],
      },
    ]);
    expect(mailDatabase.getMailboxSyncState("inbox")).toEqual({
      mailboxId: "inbox",
      highestUid: 11,
      lastSyncedAt: "2026-05-24T12:05:00.000Z",
    });
    expect(firstResult.fetchedMessageCount).toBe(1);
    expect(secondResult.fetchedMessageCount).toBe(1);
  });

  it("removes stale Mailbox entries when Gmail no longer reports a Message in that Mailbox", async () => {
    const persistence = createHybridPersistence();
    const account: ConfiguredMailAccount = {
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "personal-app-password",
    };
    const mailDatabase = persistence.mailDatabaseFor("personal");
    const client: MessageSyncClient = {
      async listRecentMessages() {
        return [
          {
            id: "message-1",
            stableIdentity: "gmail:personal:message-1",
            uid: 42,
            subject: "Archived elsewhere",
            receivedAt: "2026-05-23T10:00:00.000Z",
            unread: true,
            readableBody: "<p>Hello</p>",
            attachments: [],
            mailboxIds: ["all-mail"],
          },
        ];
      },
    };
    mailDatabase.saveMailbox({ id: "inbox", name: "Inbox", unreadCount: 1 });
    mailDatabase.saveMailbox({ id: "all-mail", name: "All Mail", unreadCount: 1 });
    mailDatabase.saveMessage({
      id: "message-1",
      stableIdentity: "gmail:personal:message-1",
      subject: "Archived elsewhere",
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
    mailDatabase.saveMailboxEntry({
      id: "message-1:all-mail",
      mailboxId: "all-mail",
      messageId: "message-1",
    });

    await syncRecentMessages({
      accounts: [account],
      persistence,
      client,
      now: new Date("2026-05-24T12:00:00.000Z"),
    });

    expect(mailDatabase.listMessagesForMailbox("inbox").messages).toEqual([]);
    expect(mailDatabase.listMessagesForMailbox("all-mail").messages).toEqual([
      expect.objectContaining({
        id: "message-1",
        mailboxIds: ["all-mail"],
      }),
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
      ccRecipients: [{ address: "copy@example.com", displayName: "Copy" }],
      bccRecipients: [{ address: "hidden@example.com" }],
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
      sync: { recentMessageWindowDays: 30 },
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
          ccRecipients: [{ address: "copy@example.com", displayName: "Copy" }],
          bccRecipients: [{ address: "hidden@example.com" }],
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
        ccRecipients: [{ address: "copy@example.com", displayName: "Copy" }],
        bccRecipients: [{ address: "hidden@example.com" }],
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
        inlineResources: [],
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

  it("exposes Messages for a Mailbox ID containing slashes", async () => {
    const persistence = createHybridPersistence();
    const account: ConfiguredMailAccount = {
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "personal-app-password",
    };
    const mailDatabase = persistence.mailDatabaseFor("personal");
    mailDatabase.saveMailbox({ id: "INBOX/06蓓雯", name: "INBOX/06蓓雯", unreadCount: 1 });
    mailDatabase.saveMessage({
      id: "message-1",
      stableIdentity: "gmail:personal:message-1",
      subject: "Nested label Message",
      receivedAt: "2026-05-23T10:00:00.000Z",
      unread: true,
      starred: false,
      aiProcessed: false,
      readableBody: "<p>Hello</p>",
      attachments: [],
    });
    mailDatabase.saveMailboxEntry({
      id: "message-1:INBOX/06蓓雯",
      mailboxId: "INBOX/06蓓雯",
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

    const response = await app.request(
      "/api/mail-accounts/personal/mailboxes/INBOX%2F06%E8%93%93%E9%9B%AF/messages",
      {
        headers: { cookie: loginResponse.headers.get("set-cookie") ?? "" },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      messages: [
        {
          id: "message-1",
          mailboxIds: ["INBOX/06蓓雯"],
        },
      ],
    });
  });

  it("syncs recent Messages during manual Mail account refresh", async () => {
    const persistence = createHybridPersistence();
    const account: ConfiguredMailAccount = {
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "personal-app-password",
    };
    const app = createApp({
      appLogin: { username: "reader", password: "secret", sessionSecret: "test-session-secret" },
      mailAccounts: [account],
      persistence,
      mailboxSyncClient: {
        async listVisibleMailboxes() {
          return [{ id: "inbox", name: "Inbox", unreadCount: 1 }];
        },
      },
      messageSyncClient: {
        async listRecentMessages(request) {
          expect(request.account).toBe(account);
          expect(request.mailboxes).toHaveLength(1);
          expect(request.mailboxes[0]?.id).toBe("inbox");
          expect(request.mailboxes[0]?.since).toBeInstanceOf(Date);
          expect(request.mailboxes[0]?.since?.getTime()).toBeGreaterThan(
            new Date("2026-01-01").getTime(),
          );

          return [
            {
              id: "message-1",
              stableIdentity: "gmail:personal:message-1",
              uid: 42,
              subject: "Synced during refresh",
              receivedAt: "2026-05-23T10:00:00.000Z",
              unread: true,
              readableBody: "<p>Hello from refresh</p>",
              attachments: [],
              mailboxIds: ["inbox"],
            },
          ];
        },
      },
    });
    const loginResponse = await app.request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "reader", password: "secret" }),
      headers: { "content-type": "application/json" },
    });
    const cookie = loginResponse.headers.get("set-cookie") ?? "";

    const refreshResponse = await app.request("/api/mail-accounts/personal/refresh", {
      method: "POST",
      headers: { cookie },
    });
    const listResponse = await app.request("/api/mail-accounts/personal/mailboxes/inbox/messages", {
      headers: { cookie },
    });

    expect(refreshResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({
      messages: [
        {
          id: "message-1",
          subject: "Synced during refresh",
          unread: true,
        },
      ],
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

    const mailboxTree = await app.request("/api/mailbox-tree", { headers: { cookie } });
    expect(await mailboxTree.json()).toMatchObject({
      mailAccounts: [
        {
          id: "personal",
          unreadCount: 2,
        },
      ],
    });
  });

  it("counts overlapping unread Mailbox entries once at the Mail account level", async () => {
    const persistence = createHybridPersistence();
    const account: ConfiguredMailAccount = {
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "personal-app-password",
    };
    const mailDatabase = persistence.mailDatabaseFor("personal");
    mailDatabase.saveMailbox({ id: "INBOX", name: "INBOX", unreadCount: 2 });
    mailDatabase.saveMailbox({ id: "INBOX/03赜婧", name: "INBOX/03赜婧", unreadCount: 1 });
    mailDatabase.saveMailbox({ id: "[Gmail]/All Mail", name: "[Gmail]/All Mail", unreadCount: 2 });
    mailDatabase.saveMessage({
      id: "message-1",
      stableIdentity: "gmail:personal:message-1",
      subject: "Unread in multiple Mailboxes",
      receivedAt: "2026-05-23T10:00:00.000Z",
      unread: true,
      starred: false,
      aiProcessed: false,
      readableBody: "",
      attachments: [],
    });

    for (const mailboxId of ["INBOX", "INBOX/03赜婧", "[Gmail]/All Mail"]) {
      mailDatabase.saveMailboxEntry({
        id: `message-1:${mailboxId}`,
        mailboxId,
        messageId: "message-1",
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
    const response = await app.request("/api/mailbox-tree", {
      headers: { cookie: loginResponse.headers.get("set-cookie") ?? "" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mailAccounts: [
        {
          id: "personal",
          unreadCount: 2,
        },
      ],
    });
  });

  it("uses All Mail unread count for the Mail account level instead of Spam unread", async () => {
    const persistence = createHybridPersistence();
    const account: ConfiguredMailAccount = {
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "personal-app-password",
    };
    const mailDatabase = persistence.mailDatabaseFor("personal");
    mailDatabase.saveMailbox({ id: "[Gmail]/All Mail", name: "[Gmail]/All Mail", unreadCount: 0 });
    mailDatabase.saveMailbox({ id: "[Gmail]/Spam", name: "[Gmail]/Spam", unreadCount: 1 });
    mailDatabase.saveMessage({
      id: "spam-message",
      stableIdentity: "gmail:personal:spam-message",
      subject: "Spam unread",
      receivedAt: "2026-05-23T10:00:00.000Z",
      unread: true,
      starred: false,
      aiProcessed: false,
      readableBody: "",
      attachments: [],
    });
    mailDatabase.saveMailboxEntry({
      id: "spam-message:[Gmail]/Spam",
      mailboxId: "[Gmail]/Spam",
      messageId: "spam-message",
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
    const response = await app.request("/api/mailbox-tree", {
      headers: { cookie: loginResponse.headers.get("set-cookie") ?? "" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mailAccounts: [
        {
          id: "personal",
          unreadCount: 0,
        },
      ],
    });
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
