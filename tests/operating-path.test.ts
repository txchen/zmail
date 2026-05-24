import { describe, expect, it } from "vite-plus/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigFromFile } from "../apps/api/src/config";
import type { ConfiguredMailAccount } from "../apps/api/src/config";
import { createApp } from "../apps/api/src/app";
import { createHybridPersistence } from "../apps/api/src/persistence";
import type { MailboxSyncClient } from "../apps/api/src/sync";
import { createSyncScheduler } from "../apps/api/src/scheduler";

describe("MVP operating path", () => {
  it("reports missing and invalid startup configuration clearly", () => {
    expect(() => loadConfigFromFile("/missing/zmail.toml")).toThrow(
      "Missing App configuration file at /missing/zmail.toml",
    );
    expect(() =>
      loadConfigFromFile(
        writeConfig(`
          [app_login]
          username = "reader"
          password = "secret"
          session_secret = "test-session-secret"
        `),
      ),
    ).toThrow("Invalid App configuration: missing mail_accounts");
    expect(() =>
      loadConfigFromFile(
        writeConfig(`
          [app_login]
          username = "reader"
          password = "secret"
          session_secret = "test-session-secret"

          [[mail_accounts]]
          id = "Personal"
          email_address = "me@example.com"
          app_password = "personal-app-password"
        `),
      ),
    ).toThrow("Invalid mail_accounts[0].id: expected lowercase slug");
    expect(() =>
      loadConfigFromFile(
        writeConfig(`
          [app_login]
          username = "reader"
          password = "secret"
          session_secret = "test-session-secret"
          password_hint = "local"

          [[mail_accounts]]
          id = "personal"
          email_address = "me@example.com"
          app_password = "personal-app-password"
        `),
      ),
    ).toThrow("Invalid app_login: unknown password_hint");
  });

  it("polls configured Mail accounts and prevents overlapping sync for the same account", async () => {
    const account: ConfiguredMailAccount = {
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "personal-app-password",
    };
    const calls: string[] = [];
    let releaseSync: (() => void) | undefined;
    const client: MailboxSyncClient = {
      async listVisibleMailboxes(syncAccount) {
        calls.push(syncAccount.id);
        if (calls.length === 1) {
          await new Promise<void>((resolve) => {
            releaseSync = resolve;
          });
        }

        return [{ id: "inbox", name: "Inbox", unreadCount: 1 }];
      },
    };
    const scheduler = createSyncScheduler({
      accounts: [account],
      client,
      intervalMs: 1000,
      persistence: createHybridPersistence(),
    });

    const first = scheduler.pollNow();
    const overlapping = scheduler.refreshAccount("personal");
    await Promise.resolve();

    expect(calls).toEqual(["personal"]);
    releaseSync?.();
    await first;
    await overlapping;

    await scheduler.refreshAccount("personal");
    expect(calls).toEqual(["personal", "personal"]);
  });

  it("covers the main home-network flow from login through AI unread access", async () => {
    const account: ConfiguredMailAccount = {
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "personal-app-password",
    };
    const persistence = createHybridPersistence();
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
      subject: "Home network flow",
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
    const cookie = loginResponse.headers.get("set-cookie") ?? "";

    expect(loginResponse.status).toBe(204);
    expect(await (await app.request("/api/mailbox-tree", { headers: { cookie } })).json()).toEqual({
      mailAccounts: [
        {
          id: "personal",
          emailAddress: "me@example.com",
          syncStatus: "synced",
          unreadCount: 1,
          mailboxes: [{ id: "inbox", name: "Inbox", unreadCount: 1 }],
        },
      ],
    });
    expect(
      await (
        await app.request("/api/mail-accounts/personal/mailboxes/inbox/messages", {
          headers: { cookie },
        })
      ).json(),
    ).toMatchObject({
      messages: [{ id: "message-1", stableIdentity: "gmail:personal:message-1" }],
    });
    expect(
      await (
        await app.request("/api/mail-accounts/personal/messages/message-1", {
          headers: { cookie },
        })
      ).json(),
    ).toMatchObject({
      message: { id: "message-1", readableBody: "<p>Hello</p>" },
    });
    expect(await (await app.request("/ai-api/messages/unread")).json()).toMatchObject({
      messages: [{ stableIdentity: "gmail:personal:message-1", unread: true }],
    });
  });
});

function writeConfig(contents: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "zmail-config-")), "zmail.toml");
  writeFileSync(path, contents);

  return path;
}
