import { describe, expect, it, vi } from "vitest";
import type { AccountOpenResponse } from "../packages/shared/src";
import { createApp } from "../apps/api/src/app";
import type { GmailImapReader } from "../apps/api/src/live-imap";

const personalAccountOpen: AccountOpenResponse = {
  mailAccount: {
    id: "personal",
    emailAddress: "me@example.com",
    unreadCount: 2,
    mailboxes: [
      {
        id: "INBOX",
        name: "Inbox",
        path: "INBOX",
        systemRole: "inbox",
        unreadCount: 2,
        totalCount: 8,
        selectable: true,
      },
      {
        id: "[Gmail]/Trash",
        name: "Trash",
        path: "[Gmail]/Trash",
        systemRole: "trash",
        unreadCount: 0,
        totalCount: 3,
        selectable: true,
      },
    ],
  },
  inbox: {
    mailboxId: "INBOX",
    messages: [
      {
        accountId: "personal",
        id: "1876543210",
        subject: "Account open",
        sender: { address: "sender@example.com", displayName: "Sender" },
        recipients: [{ address: "me@example.com" }],
        receivedAt: "2026-07-17T12:00:00.000Z",
        unread: true,
        starred: false,
      },
    ],
  },
};

describe("Live IMAP Account open API", () => {
  it("does not access Gmail during App login or configured Mail account listing", async () => {
    const openAccount = vi.fn<GmailImapReader["openAccount"]>();
    const app = createApp(testConfig({ openAccount, closeAllSessions: vi.fn() }));

    const loginResponse = await login(app);
    const cookie = loginResponse.headers.get("set-cookie") ?? "";
    const accountsResponse = await app.request("/api/mail-accounts", {
      headers: { cookie },
    });

    expect(loginResponse.status).toBe(204);
    expect(accountsResponse.status).toBe(200);
    expect(openAccount).not.toHaveBeenCalled();
  });

  it("opens one configured Mail account with its mailbox tree, counts, and first Inbox page", async () => {
    const openAccount = vi.fn<GmailImapReader["openAccount"]>();
    openAccount.mockResolvedValue(personalAccountOpen);
    const app = createApp(testConfig({ openAccount, closeAllSessions: vi.fn() }));
    const cookie = (await login(app)).headers.get("set-cookie") ?? "";

    const response = await app.request("/api/mail-accounts/personal/open", {
      method: "POST",
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(personalAccountOpen);
    expect(openAccount).toHaveBeenCalledWith({
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "personal-app-password",
    });
  });

  it("isolates a failing Mail account from another configured account", async () => {
    const openAccount = vi.fn<GmailImapReader["openAccount"]>(async (account) => {
      if (account.id === "personal") {
        throw new Error("Gmail unavailable");
      }

      return {
        ...personalAccountOpen,
        mailAccount: {
          ...personalAccountOpen.mailAccount,
          id: "work",
          emailAddress: "work@example.com",
        },
        inbox: {
          ...personalAccountOpen.inbox,
          messages: personalAccountOpen.inbox.messages.map((message) => ({
            ...message,
            accountId: "work",
          })),
        },
      };
    });
    const app = createApp(testConfig({ openAccount, closeAllSessions: vi.fn() }));
    const cookie = (await login(app)).headers.get("set-cookie") ?? "";

    const failed = await app.request("/api/mail-accounts/personal/open", {
      method: "POST",
      headers: { cookie },
    });
    const healthy = await app.request("/api/mail-accounts/work/open", {
      method: "POST",
      headers: { cookie },
    });

    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({
      error: "Mail account unavailable",
      accountId: "personal",
    });
    expect(healthy.status).toBe(200);
    expect((await healthy.json()).mailAccount.id).toBe("work");
  });

  it("closes all coordinated IMAP sessions on logout", async () => {
    const closeAllSessions = vi.fn(async () => undefined);
    const app = createApp(
      testConfig({
        openAccount: vi.fn(async () => personalAccountOpen),
        closeAllSessions,
      }),
    );
    const anonymousResponse = await app.request("/api/logout", { method: "POST" });
    const cookie = (await login(app)).headers.get("set-cookie") ?? "";

    const response = await app.request("/api/logout", {
      method: "POST",
      headers: { cookie },
    });

    expect(anonymousResponse.status).toBe(204);
    expect(response.status).toBe(204);
    expect(closeAllSessions).toHaveBeenCalledOnce();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

function testConfig(gmailImapReader: GmailImapReader) {
  return {
    appLogin: {
      username: "reader",
      password: "secret",
      sessionSecret: "test-session-secret",
    },
    mailAccounts: [
      {
        id: "personal",
        emailAddress: "me@example.com",
        appPassword: "personal-app-password",
      },
      {
        id: "work",
        emailAddress: "work@example.com",
        appPassword: "work-app-password",
      },
    ],
    gmailImapReader,
  };
}

async function login(app: ReturnType<typeof createApp>) {
  return app.request("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: "reader", password: "secret" }),
    headers: { "content-type": "application/json" },
  });
}
