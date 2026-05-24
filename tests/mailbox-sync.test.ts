import { describe, expect, it } from "vite-plus/test";
import { createApp } from "../apps/api/src/app";
import type { ConfiguredMailAccount } from "../apps/api/src/config";
import { createHybridPersistence } from "../apps/api/src/persistence";
import type { ImapMailbox, MailboxSyncClient } from "../apps/api/src/sync";
import { syncMailboxTrees } from "../apps/api/src/sync";
import {
  fetchAccountSyncStatus,
  fetchMailboxTree,
  refreshMailAccount,
  runMailAccountDiagnostics,
} from "../apps/web/src/api";

describe("mailbox tree sync", () => {
  it("syncs visible Gmail Mailboxes per account and isolates account failures", async () => {
    const persistence = createHybridPersistence();
    const accounts: ConfiguredMailAccount[] = [
      {
        id: "personal",
        emailAddress: "me@example.com",
        appPassword: "personal-app-password",
      },
      {
        id: "work",
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
    expect(persistence.app.listMailAccounts()).toMatchObject([
      {
        id: "personal",
        emailAddress: "me@example.com",
        syncStatus: "synced",
        lastSyncStartedAt: expect.any(String),
        lastSyncFinishedAt: expect.any(String),
      },
      {
        id: "work",
        emailAddress: "me@work.example",
        syncStatus: "failing",
        lastSyncStartedAt: expect.any(String),
        lastSyncFinishedAt: expect.any(String),
        lastError: "IMAP login failed",
      },
    ]);
    expect(persistence.mailDatabaseFor("personal").listMailboxes()).toEqual([
      {
        id: "inbox",
        name: "Inbox",
        path: "Inbox",
        unreadCount: 3,
        totalCount: 3,
        selectable: true,
      },
      {
        id: "spam",
        name: "[Gmail]/Spam",
        path: "[Gmail]/Spam",
        unreadCount: 1,
        totalCount: 1,
        selectable: true,
      },
      {
        id: "trash",
        name: "[Gmail]/Trash",
        path: "[Gmail]/Trash",
        unreadCount: 0,
        totalCount: 0,
        selectable: true,
      },
    ]);
    expect(persistence.mailDatabaseFor("work").listMailboxes()).toEqual([]);
  });

  it("exposes authenticated account mailbox trees with unread counts and sync status", async () => {
    const persistence = createHybridPersistence();
    const accounts: ConfiguredMailAccount[] = [
      {
        id: "personal",
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
            {
              id: "inbox",
              name: "Inbox",
              path: "Inbox",
              unreadCount: 3,
              totalCount: 3,
              selectable: true,
            },
            {
              id: "spam",
              name: "[Gmail]/Spam",
              path: "[Gmail]/Spam",
              unreadCount: 1,
              totalCount: 1,
              selectable: true,
            },
            {
              id: "trash",
              name: "[Gmail]/Trash",
              path: "[Gmail]/Trash",
              unreadCount: 0,
              totalCount: 0,
              selectable: true,
            },
          ];
        },
      },
    });

    const app = createApp({
      appLogin: { username: "reader", password: "secret", sessionSecret: "test-session-secret" },
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
          emailAddress: "me@example.com",
          syncStatus: "synced",
          unreadCount: 4,
          mailboxes: [
            {
              id: "inbox",
              name: "Inbox",
              path: "Inbox",
              unreadCount: 3,
              totalCount: 3,
              selectable: true,
            },
            {
              id: "spam",
              name: "[Gmail]/Spam",
              path: "[Gmail]/Spam",
              unreadCount: 1,
              totalCount: 1,
              selectable: true,
            },
            {
              id: "trash",
              name: "[Gmail]/Trash",
              path: "[Gmail]/Trash",
              unreadCount: 0,
              totalCount: 0,
              selectable: true,
            },
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
          emailAddress: "me@example.com",
          syncStatus: "synced",
          unreadCount: 4,
          mailboxes: [
            {
              id: "inbox",
              name: "Inbox",
              path: "Inbox",
              unreadCount: 3,
              totalCount: 3,
              selectable: true,
            },
            {
              id: "spam",
              name: "[Gmail]/Spam",
              path: "[Gmail]/Spam",
              unreadCount: 1,
              totalCount: 1,
              selectable: true,
            },
            {
              id: "trash",
              name: "[Gmail]/Trash",
              path: "[Gmail]/Trash",
              unreadCount: 0,
              totalCount: 0,
              selectable: true,
            },
          ],
        },
      ],
    });
  });

  it("syncs flat Mailbox metadata with system roles, hierarchy, counts, and selectable state", async () => {
    const persistence = createHybridPersistence();
    const accounts: ConfiguredMailAccount[] = [
      {
        id: "personal",
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
            {
              id: "inbox",
              name: "Inbox",
              path: "Inbox",
              specialUse: "\\Inbox",
              unreadCount: 3,
              totalCount: 10,
              selectable: true,
            },
            {
              id: "projects",
              name: "Projects",
              path: "Projects",
              unreadCount: 1,
              totalCount: 4,
              selectable: false,
            },
            {
              id: "projects-zmail",
              name: "Zmail",
              path: "Projects/Zmail",
              parentId: "projects",
              unreadCount: 1,
              totalCount: 2,
              selectable: true,
            },
          ];
        },
      },
    });

    const app = createApp({
      appLogin: { username: "reader", password: "secret", sessionSecret: "test-session-secret" },
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
    expect(await response.json()).toMatchObject({
      mailAccounts: [
        {
          id: "personal",
          mailboxes: [
            {
              id: "inbox",
              name: "Inbox",
              path: "Inbox",
              systemRole: "inbox",
              unreadCount: 3,
              totalCount: 10,
              selectable: true,
            },
            {
              id: "projects",
              name: "Projects",
              path: "Projects",
              unreadCount: 1,
              totalCount: 4,
              selectable: false,
            },
            {
              id: "projects-zmail",
              name: "Zmail",
              path: "Projects/Zmail",
              parentId: "projects",
              unreadCount: 1,
              totalCount: 2,
              selectable: true,
            },
          ],
        },
      ],
    });
  });

  it("shows configured Mail accounts before their first successful sync", async () => {
    const persistence = createHybridPersistence();
    const accounts: ConfiguredMailAccount[] = [
      {
        id: "personal",
        emailAddress: "me@example.com",
        appPassword: "personal-app-password",
      },
    ];
    const app = createApp({
      appLogin: { username: "reader", password: "secret", sessionSecret: "test-session-secret" },
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
          emailAddress: "me@example.com",
          syncStatus: "stale",
          unreadCount: 0,
          mailboxes: [],
        },
      ],
    });
  });

  it("lets the App user trigger manual refresh for one Mail account", async () => {
    const persistence = createHybridPersistence();
    const accounts: ConfiguredMailAccount[] = [
      {
        id: "personal",
        emailAddress: "me@example.com",
        appPassword: "personal-app-password",
      },
    ];
    let unreadCount = 1;
    const app = createApp({
      appLogin: { username: "reader", password: "secret", sessionSecret: "test-session-secret" },
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
          emailAddress: "me@example.com",
          syncStatus: "synced",
          unreadCount: 1,
          mailboxes: [
            {
              id: "inbox",
              name: "Inbox",
              path: "Inbox",
              unreadCount: 1,
              totalCount: 1,
              selectable: true,
            },
          ],
        },
      ],
    });
    await expect(
      fetchMailboxTree((path) => app.request(path, { headers: { cookie } })),
    ).resolves.toEqual({
      mailAccounts: [
        {
          id: "personal",
          emailAddress: "me@example.com",
          syncStatus: "synced",
          unreadCount: 1,
          mailboxes: [
            {
              id: "inbox",
              name: "Inbox",
              path: "Inbox",
              unreadCount: 1,
              totalCount: 1,
              selectable: true,
            },
          ],
        },
      ],
    });
  });

  it("exposes authenticated Account sync status and records manual refresh failures", async () => {
    const persistence = createHybridPersistence();
    const accounts: ConfiguredMailAccount[] = [
      {
        id: "personal",
        emailAddress: "me@example.com",
        appPassword: "personal-app-password",
      },
    ];
    const app = createApp({
      appLogin: { username: "reader", password: "secret", sessionSecret: "test-session-secret" },
      mailAccounts: accounts,
      persistence,
      mailboxSyncClient: {
        async listVisibleMailboxes() {
          throw new Error("IMAP login failed");
        },
      },
    });
    const loginResponse = await app.request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "reader", password: "secret" }),
      headers: { "content-type": "application/json" },
    });
    const cookie = loginResponse.headers.get("set-cookie") ?? "";

    const anonymousResponse = await app.request("/api/mail-accounts/personal/sync-status");
    expect(anonymousResponse.status).toBe(401);

    const refreshResponse = await app.request("/api/mail-accounts/personal/refresh", {
      method: "POST",
      headers: { cookie },
    });
    expect(refreshResponse.status).toBe(200);

    const statusResponse = await app.request("/api/mail-accounts/personal/sync-status", {
      headers: { cookie },
    });
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toEqual({
      accountId: "personal",
      syncStatus: "failing",
      lastSyncStartedAt: expect.any(String),
      lastSyncFinishedAt: expect.any(String),
      lastError: "IMAP login failed",
    });
    expect(await (await app.request("/ai-api/mail-accounts")).json()).toEqual({
      mailAccounts: [
        {
          id: "personal",
          emailAddress: "me@example.com",
          syncStatus: "failing",
        },
      ],
    });

    const unknownResponse = await app.request("/api/mail-accounts/unknown/sync-status", {
      headers: { cookie },
    });
    expect(unknownResponse.status).toBe(404);
  });

  it("diagnoses a Mail account without saving Mailboxes", async () => {
    const persistence = createHybridPersistence();
    const accounts: ConfiguredMailAccount[] = [
      {
        id: "personal",
        emailAddress: "me@example.com",
        appPassword: "personal-app-password",
      },
    ];
    const app = createApp({
      appLogin: { username: "reader", password: "secret", sessionSecret: "test-session-secret" },
      mailAccounts: accounts,
      persistence,
      mailboxSyncClient: {
        async listVisibleMailboxes() {
          return [
            { id: "inbox", name: "Inbox", unreadCount: 1 },
            { id: "trash", name: "Trash", unreadCount: 0 },
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

    const response = await app.request("/api/mail-accounts/personal/diagnose", {
      method: "POST",
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      visibleMailboxCount: 2,
    });
    expect(persistence.mailDatabaseFor("personal").listMailboxes()).toEqual([]);
  });

  it("returns diagnostic failures without exposing them through AI APIs", async () => {
    const persistence = createHybridPersistence();
    const accounts: ConfiguredMailAccount[] = [
      {
        id: "personal",
        emailAddress: "me@example.com",
        appPassword: "personal-app-password",
      },
    ];
    const app = createApp({
      appLogin: { username: "reader", password: "secret", sessionSecret: "test-session-secret" },
      mailAccounts: accounts,
      persistence,
      mailboxSyncClient: {
        async listVisibleMailboxes() {
          throw new Error("credential rejected");
        },
      },
    });
    const loginResponse = await app.request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "reader", password: "secret" }),
      headers: { "content-type": "application/json" },
    });
    const cookie = loginResponse.headers.get("set-cookie") ?? "";

    const response = await app.request("/api/mail-accounts/personal/diagnose", {
      method: "POST",
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: false,
      lastError: "credential rejected",
    });

    expect(await (await app.request("/ai-api/mail-accounts")).json()).toEqual({
      mailAccounts: [],
    });
  });

  it("lets the web app fetch Account sync status and run Mail account diagnostics", async () => {
    const requests: Array<{ path: string | URL | Request; init: RequestInit | undefined }> = [];
    const fetcher = async (path: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests.push({ path, init });

      if (path === "/api/mail-accounts/personal/sync-status") {
        return Response.json({
          accountId: "personal",
          syncStatus: "failing",
          lastError: "credential rejected",
        });
      }

      return Response.json({
        success: false,
        lastError: "credential rejected",
      });
    };

    await expect(fetchAccountSyncStatus("personal", fetcher)).resolves.toEqual({
      accountId: "personal",
      syncStatus: "failing",
      lastError: "credential rejected",
    });
    await expect(runMailAccountDiagnostics("personal", fetcher)).resolves.toEqual({
      success: false,
      lastError: "credential rejected",
    });

    expect(requests).toEqual([
      {
        path: "/api/mail-accounts/personal/sync-status",
        init: undefined,
      },
      {
        path: "/api/mail-accounts/personal/diagnose",
        init: { method: "POST" },
      },
    ]);
  });
});
