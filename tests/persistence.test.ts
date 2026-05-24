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
    personal.saveMessage({
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
        subject: "Shared identity",
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
    expect(work.listMessagesWithMailboxEntries()).toEqual([]);
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
