import { describe, expect, it } from "vite-plus/test";
import { createApp } from "../apps/api/src/app";
import type { ConfiguredMailAccount } from "../apps/api/src/config";
import { createHybridPersistence } from "../apps/api/src/persistence";
import type { ImapMailbox, MailboxSyncClient } from "../apps/api/src/sync";
import { syncMailboxTrees } from "../apps/api/src/sync";
import { fetchMailboxTree, refreshMailAccount } from "../apps/web/src/api";

describe("mailbox tree sync", () => {
  it("syncs visible Gmail Mailboxes per account and isolates account failures", async () => {
    const persistence = createHybridPersistence();
    const accounts: ConfiguredMailAccount[] = [
      {
        id: "personal",
        displayName: "Personal Gmail",
        emailAddress: "me@example.com",
        appPassword: "personal-app-password",
      },
      {
        id: "work",
        displayName: "Work Gmail",
        emailAddress: "me@work.example",
        appPassword: "work-app-password",
      },
    ];
    const connections: Array<{ emailAddress: string; appPassword: string }> = [];
    const client: MailboxSyncClient = {
      async listVisibleMailboxes(account): Promise<ImapMailbox[]> {
        connections.push({
          emailAddress: account.emailAddress,
          appPassword: account.appPassword,
        });

        if (account.id === "work") {
          throw new Error("IMAP login failed");
        }

        return [
          { id: "inbox", name: "Inbox", unreadCount: 3 },
          { id: "spam", name: "[Gmail]/Spam", unreadCount: 1 },
          { id: "trash", name: "[Gmail]/Trash", unreadCount: 0 },
        ];
      },
    };

    await syncMailboxTrees({ accounts, persistence, client });

    expect(connections).toEqual([
      { emailAddress: "me@example.com", appPassword: "personal-app-password" },
      { emailAddress: "me@work.example", appPassword: "work-app-password" },
    ]);
    expect(persistence.app.listMailAccounts()).toEqual([
      {
        id: "personal",
        displayName: "Personal Gmail",
        emailAddress: "me@example.com",
        syncStatus: "synced",
      },
      {
        id: "work",
        displayName: "Work Gmail",
        emailAddress: "me@work.example",
        syncStatus: "failing",
      },
    ]);
    expect(persistence.mailDatabaseFor("personal").listMailboxes()).toEqual([
      { id: "inbox", name: "Inbox", unreadCount: 3 },
      { id: "spam", name: "[Gmail]/Spam", unreadCount: 1 },
      { id: "trash", name: "[Gmail]/Trash", unreadCount: 0 },
    ]);
    expect(persistence.mailDatabaseFor("work").listMailboxes()).toEqual([]);
  });

  it("exposes authenticated account mailbox trees with unread counts and sync status", async () => {
    const persistence = createHybridPersistence();
    const accounts: ConfiguredMailAccount[] = [
      {
        id: "personal",
        displayName: "Personal Gmail",
        emailAddress: "me@example.com",
        appPassword: "personal-app-password",
      },
    ];

    await syncMailboxTrees({
      accounts,
      persistence,
      client: {
        async listVisibleMailboxes() {
          return [
            { id: "inbox", name: "Inbox", unreadCount: 3 },
            { id: "spam", name: "[Gmail]/Spam", unreadCount: 1 },
            { id: "trash", name: "[Gmail]/Trash", unreadCount: 0 },
          ];
        },
      },
    });

    const app = createApp({
      appLogin: { username: "reader", password: "secret" },
      mailAccounts: accounts,
      persistence,
    });
    const loginResponse = await app.request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "reader", password: "secret" }),
      headers: { "content-type": "application/json" },
    });
    const cookie = loginResponse.headers.get("set-cookie") ?? "";

    const response = await app.request("/api/mailbox-tree", {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mailAccounts: [
        {
          id: "personal",
          displayName: "Personal Gmail",
          emailAddress: "me@example.com",
          syncStatus: "synced",
          unreadCount: 4,
          mailboxes: [
            { id: "inbox", name: "Inbox", unreadCount: 3 },
            { id: "spam", name: "[Gmail]/Spam", unreadCount: 1 },
            { id: "trash", name: "[Gmail]/Trash", unreadCount: 0 },
          ],
        },
      ],
    });

    await expect(
      fetchMailboxTree(() => app.request("/api/mailbox-tree", { headers: { cookie } })),
    ).resolves.toEqual({
      mailAccounts: [
        {
          id: "personal",
          displayName: "Personal Gmail",
          emailAddress: "me@example.com",
          syncStatus: "synced",
          unreadCount: 4,
          mailboxes: [
            { id: "inbox", name: "Inbox", unreadCount: 3 },
            { id: "spam", name: "[Gmail]/Spam", unreadCount: 1 },
            { id: "trash", name: "[Gmail]/Trash", unreadCount: 0 },
          ],
        },
      ],
    });
  });

  it("lets the App user trigger manual refresh for one Mail account", async () => {
    const persistence = createHybridPersistence();
    const accounts: ConfiguredMailAccount[] = [
      {
        id: "personal",
        displayName: "Personal Gmail",
        emailAddress: "me@example.com",
        appPassword: "personal-app-password",
      },
    ];
    let unreadCount = 1;
    const app = createApp({
      appLogin: { username: "reader", password: "secret" },
      mailAccounts: accounts,
      persistence,
      mailboxSyncClient: {
        async listVisibleMailboxes() {
          return [{ id: "inbox", name: "Inbox", unreadCount: unreadCount++ }];
        },
      },
    });
    const loginResponse = await app.request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "reader", password: "secret" }),
      headers: { "content-type": "application/json" },
    });
    const cookie = loginResponse.headers.get("set-cookie") ?? "";

    await expect(
      refreshMailAccount("personal", (path, init) =>
        app.request(path, { ...init, headers: { ...init?.headers, cookie } }),
      ),
    ).resolves.toEqual({
      mailAccounts: [
        {
          id: "personal",
          displayName: "Personal Gmail",
          emailAddress: "me@example.com",
          syncStatus: "synced",
          unreadCount: 1,
          mailboxes: [{ id: "inbox", name: "Inbox", unreadCount: 1 }],
        },
      ],
    });
    await expect(
      fetchMailboxTree((path) => app.request(path, { headers: { cookie } })),
    ).resolves.toEqual({
      mailAccounts: [
        {
          id: "personal",
          displayName: "Personal Gmail",
          emailAddress: "me@example.com",
          syncStatus: "synced",
          unreadCount: 1,
          mailboxes: [{ id: "inbox", name: "Inbox", unreadCount: 1 }],
        },
      ],
    });
  });
});
