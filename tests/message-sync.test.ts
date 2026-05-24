import { describe, expect, it } from "vite-plus/test";
import { createApp } from "../apps/api/src/app";
import type { ConfiguredMailAccount } from "../apps/api/src/config";
import { createHybridPersistence } from "../apps/api/src/persistence";
import type { MessageSyncClient } from "../apps/api/src/sync";
import { syncRecentMessages } from "../apps/api/src/sync";

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
    persistence.app.saveMailAccount({
      id: "personal",
      emailAddress: "me@example.com",
      syncStatus: "synced",
    });
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
});
