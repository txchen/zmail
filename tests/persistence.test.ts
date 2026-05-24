import { describe, expect, it } from "vite-plus/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/api/src/app";
import {
  createFileBackedHybridPersistence,
  createHybridPersistence,
} from "../apps/api/src/persistence";

describe("hybrid SQLite persistence", () => {
  it("stores app state once and keeps each Mail account in its own mail database", () => {
    const persistence = createHybridPersistence();

    persistence.app.saveMailAccount({
      id: "personal",
      emailAddress: "me@example.com",
      syncStatus: "syncing",
    });
    persistence.app.saveMailAccount({
      id: "work",
      emailAddress: "me@work.example",
      syncStatus: "stale",
    });

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

    expect(persistence.app.listMailAccounts()).toEqual([
      {
        id: "personal",
        emailAddress: "me@example.com",
        syncStatus: "syncing",
      },
      {
        id: "work",
        emailAddress: "me@work.example",
        syncStatus: "stale",
      },
    ]);
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

  it("persists app state and per-account mail data to SQLite files", () => {
    const databaseDir = mkdtempSync(join(tmpdir(), "zmail-db-"));
    const persistence = createFileBackedHybridPersistence(databaseDir);

    persistence.app.saveMailAccount({
      id: "personal",
      emailAddress: "me@example.com",
      syncStatus: "synced",
    });
    persistence.mailDatabaseFor("personal").saveMailbox({
      id: "inbox",
      name: "Inbox",
      unreadCount: 2,
    });

    const reopened = createFileBackedHybridPersistence(databaseDir);

    expect(reopened.app.listMailAccounts()).toEqual([
      {
        id: "personal",
        emailAddress: "me@example.com",
        syncStatus: "synced",
      },
    ]);
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
    expect(reopened.app.listMailAccounts()).toMatchObject([
      {
        id: "personal",
        syncStatus: "synced",
      },
    ]);
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
