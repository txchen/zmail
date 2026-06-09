import { describe, expect, it } from "vite-plus/test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/api/src/app";
import {
  createFileBackedHybridPersistence,
  createHybridPersistence,
} from "../apps/api/src/persistence";

describe("per-account SQLite persistence", () => {
  it("keeps each Mail account in its own mail database", () => {
    const persistence = createHybridPersistence();
    const personal = persistence.mailDatabaseFor("personal");
    const work = persistence.mailDatabaseFor("work");

    personal.saveMailbox({ id: "inbox", name: "Inbox", unreadCount: 1 });
    personal.saveMailbox({ id: "all-mail", name: "All Mail", unreadCount: 1 });
    const firstSave = personal.saveMessage({
      id: "message-1",
      stableIdentity: "gmail:personal:thread-1:message-1",
      subject: "Shared identity",
      receivedAt: "2026-05-23T10:00:00.000Z",
      unread: true,
      starred: false,
      aiProcessed: false,
      readableBody: "<p>Hello</p>",
      attachments: [],
    });
    const secondSave = personal.saveMessage({
      id: "message-1",
      stableIdentity: "gmail:personal:thread-1:message-1",
      subject: "Updated shared identity",
      receivedAt: "2026-05-23T10:00:00.000Z",
      unread: true,
      starred: false,
      aiProcessed: false,
      readableBody: "<p>Hello</p>",
      attachments: [],
    });
    personal.saveMailboxEntry({
      id: "entry-inbox",
      mailboxId: "inbox",
      messageId: "message-1",
    });
    personal.saveMailboxEntry({
      id: "entry-all-mail",
      mailboxId: "all-mail",
      messageId: "message-1",
    });

    expect(personal.listMessagesWithMailboxEntries()).toEqual([
      {
        id: "message-1",
        stableIdentity: "gmail:personal:thread-1:message-1",
        subject: "Updated shared identity",
        receivedAt: "2026-05-23T10:00:00.000Z",
        unread: true,
        starred: false,
        aiProcessed: false,
        readableBody: "<p>Hello</p>",
        attachments: [],
        mailboxEntries: [
          { id: "entry-inbox", mailboxId: "inbox", mailboxName: "Inbox" },
          { id: "entry-all-mail", mailboxId: "all-mail", mailboxName: "All Mail" },
        ],
      },
    ]);
    expect(firstSave).toEqual({ inserted: true });
    expect(secondSave).toEqual({ inserted: false });
    expect(work.listMessagesWithMailboxEntries()).toEqual([]);
  });

  it("stores per-Mailbox sync checkpoints and keeps the highest UID", () => {
    const persistence = createHybridPersistence();
    const mailDatabase = persistence.mailDatabaseFor("personal");

    expect(mailDatabase.getMailboxSyncState("inbox")).toBeUndefined();

    mailDatabase.saveMailboxSyncState({
      mailboxId: "inbox",
      highestUid: 42,
      lastSyncedAt: "2026-05-24T10:00:00.000Z",
    });
    mailDatabase.saveMailboxSyncState({
      mailboxId: "inbox",
      highestUid: 40,
      lastSyncedAt: "2026-05-24T11:00:00.000Z",
    });

    expect(mailDatabase.getMailboxSyncState("inbox")).toEqual({
      mailboxId: "inbox",
      highestUid: 42,
      lastSyncedAt: "2026-05-24T11:00:00.000Z",
    });
  });

  it("treats Starred mailbox membership as starred when reading messages", () => {
    const persistence = createHybridPersistence();
    const mailDatabase = persistence.mailDatabaseFor("personal");

    mailDatabase.saveMailbox({ id: "inbox", name: "Inbox", unreadCount: 0 });
    mailDatabase.saveMailbox({ id: "[Gmail]/Starred", name: "[Gmail]/Starred", unreadCount: 0 });
    mailDatabase.saveMessage({
      id: "message-1",
      stableIdentity: "gmail:personal:message-1",
      subject: "Google Payment Corp: $110.29 USD",
      receivedAt: "2026-05-23T10:00:00.000Z",
      unread: false,
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
      id: "message-1:[Gmail]/Starred",
      mailboxId: "[Gmail]/Starred",
      messageId: "message-1",
    });

    expect(mailDatabase.listMessagesForMailbox("personal", "[Gmail]/Starred").messages).toEqual([
      expect.objectContaining({ id: "message-1", starred: true }),
    ]);
    expect(mailDatabase.getMessage("personal", "message-1")).toMatchObject({
      id: "message-1",
      starred: true,
    });
  });

  it("persists per-account mail data to SQLite files without app.sqlite", () => {
    const databaseDir = mkdtempSync(join(tmpdir(), "zmail-db-"));
    const persistence = createFileBackedHybridPersistence(databaseDir);

    persistence.mailDatabaseFor("personal").saveMailbox({
      id: "inbox",
      name: "Inbox",
      unreadCount: 2,
    });

    const reopened = createFileBackedHybridPersistence(databaseDir);

    expect(existsSync(join(databaseDir, "app.sqlite"))).toBe(false);
    expect(existsSync(join(databaseDir, "mail"))).toBe(false);
    expect(existsSync(join(databaseDir, "personal.sqlite"))).toBe(true);
    expect(reopened.mailDatabaseFor("personal").listMailboxes()).toEqual([
      {
        id: "inbox",
        name: "Inbox",
        path: "Inbox",
        unreadCount: 2,
        totalCount: 2,
        selectable: true,
      },
    ]);
  });

  it("stores per-message inline resources with reusable local ids", () => {
    const persistence = createHybridPersistence();
    const mailDatabase = persistence.mailDatabaseFor("personal");

    for (const messageId of ["message-1", "message-2"]) {
      mailDatabase.saveMessage({
        id: messageId,
        stableIdentity: `gmail:personal:${messageId}`,
        subject: "Inline image",
        receivedAt: "2026-05-23T10:00:00.000Z",
        unread: true,
        starred: false,
        aiProcessed: false,
        readableBody: "<p>Hello</p>",
        inlineResources: [
          {
            id: "inline-0",
            contentId: "image001.png@example.com",
            mimeType: "image/png",
            sizeBytes: 3,
            bytes: new Uint8Array([1, 2, 3]),
          },
        ],
        attachments: [],
      });
    }

    expect(mailDatabase.getMessage("personal", "message-1")?.inlineResources).toEqual([
      {
        id: "inline-0",
        contentId: "image001.png@example.com",
        mimeType: "image/png",
        sizeBytes: 3,
      },
    ]);
    expect(mailDatabase.getInlineMessageResource("message-2", "inline-0")).toMatchObject({
      id: "message-2:inline-0",
      contentId: "image001.png@example.com",
      mimeType: "image/png",
      sizeBytes: 3,
    });
  });

  it("ignores duplicate inline content ids for one message", () => {
    const persistence = createHybridPersistence();
    const mailDatabase = persistence.mailDatabaseFor("personal");

    mailDatabase.saveMessage({
      id: "message-1",
      stableIdentity: "gmail:personal:message-1",
      subject: "Duplicate inline image",
      receivedAt: "2026-05-23T10:00:00.000Z",
      unread: true,
      starred: false,
      aiProcessed: false,
      readableBody: '<img src="cid:image001.png@example.com">',
      inlineResources: [
        {
          id: "inline-0",
          contentId: "image001.png@example.com",
          mimeType: "image/png",
          sizeBytes: 3,
          bytes: new Uint8Array([1, 2, 3]),
        },
        {
          id: "inline-1",
          contentId: "image001.png@example.com",
          mimeType: "image/png",
          sizeBytes: 3,
          bytes: new Uint8Array([4, 5, 6]),
        },
      ],
      attachments: [],
    });

    expect(mailDatabase.getMessage("personal", "message-1")?.inlineResources).toEqual([
      {
        id: "inline-0",
        contentId: "image001.png@example.com",
        mimeType: "image/png",
        sizeBytes: 3,
      },
    ]);
    expect(mailDatabase.getInlineMessageResource("message-1", "inline-0")?.bytes).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("uses configured file-backed storage when the app creates persistence", async () => {
    const databaseDir = mkdtempSync(join(tmpdir(), "zmail-app-db-"));
    const app = createApp({
      appLogin: { username: "reader", password: "secret", sessionSecret: "test-session-secret" },
      storage: { databaseDir },
      mailAccounts: [
        {
          id: "personal",
          emailAddress: "me@example.com",
          appPassword: "personal-app-password",
        },
      ],
      mailboxSyncClient: {
        async listVisibleMailboxes() {
          return [{ id: "inbox", name: "Inbox", unreadCount: 1 }];
        },
      },
    });

    const loginResponse = await app.request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "reader", password: "secret" }),
      headers: { "content-type": "application/json" },
    });
    await app.request("/api/mail-accounts/personal/refresh", {
      method: "POST",
      headers: { cookie: loginResponse.headers.get("set-cookie") ?? "" },
    });

    const reopened = createFileBackedHybridPersistence(databaseDir);
    expect(existsSync(join(databaseDir, "app.sqlite"))).toBe(false);
    expect(existsSync(join(databaseDir, "mail"))).toBe(false);
    expect(existsSync(join(databaseDir, "personal.sqlite"))).toBe(true);
    expect(reopened.mailDatabaseFor("personal").listMailboxes()).toEqual([
      {
        id: "inbox",
        name: "Inbox",
        path: "Inbox",
        unreadCount: 1,
        totalCount: 1,
        selectable: true,
      },
    ]);
  });
});
