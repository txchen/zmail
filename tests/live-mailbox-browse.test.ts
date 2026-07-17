import type {
  AccountOpenResponse,
  AccountRefreshResponse,
  LiveMessagePage,
} from "../packages/shared/src";
import { describe, expect, it, vi } from "vite-plus/test";
import { createApp } from "../apps/api/src/app";
import type { GmailImapReader } from "../apps/api/src/live-imap";

const emptyAccountOpen: AccountOpenResponse = {
  mailAccount: {
    id: "personal",
    emailAddress: "me@example.com",
    unreadCount: 0,
    mailboxes: [],
  },
  inbox: {
    mailboxId: "INBOX",
    messages: [],
  },
};

const mailboxPage: LiveMessagePage = {
  messages: [
    {
      accountId: "personal",
      id: "gmail-message-2",
      subject: "Newest",
      sender: { address: "sender@example.com" },
      recipients: [{ address: "me@example.com" }],
      receivedAt: "2026-07-17T12:00:00.000Z",
      unread: true,
      starred: false,
    },
  ],
  nextCursor: "opaque-next-page",
};

describe("Live IMAP Mailbox browsing API", () => {
  it("reads one Mailbox page through the configured account and passes an opaque cursor", async () => {
    const listMailbox = vi.fn<GmailImapReader["listMailbox"]>(async () => mailboxPage);
    const reader = testReader({ listMailbox });
    const app = createApp(testConfig(reader));
    const cookie = (await login(app)).headers.get("set-cookie") ?? "";

    const response = await app.request(
      "/api/mail-accounts/personal/mailboxes/%5BGmail%5D%2FSent/messages?cursor=opaque-current-page",
      { headers: { cookie } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(mailboxPage);
    expect(listMailbox).toHaveBeenCalledWith(
      {
        id: "personal",
        emailAddress: "me@example.com",
        appPassword: "personal-app-password",
      },
      "[Gmail]/Sent",
      "opaque-current-page",
    );
  });

  it("reads the account unread view only through the selected account", async () => {
    const listUnread = vi.fn<GmailImapReader["listUnread"]>(async () => mailboxPage);
    const reader = testReader({ listUnread });
    const app = createApp(testConfig(reader));
    const cookie = (await login(app)).headers.get("set-cookie") ?? "";

    const response = await app.request(
      "/api/mail-accounts/personal/messages/unread?cursor=opaque-unread-page",
      { headers: { cookie } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(mailboxPage);
    expect(listUnread).toHaveBeenCalledWith(
      {
        id: "personal",
        emailAddress: "me@example.com",
        appPassword: "personal-app-password",
      },
      "opaque-unread-page",
    );
  });

  it("rejects unknown accounts before accessing Gmail", async () => {
    const reader = testReader();
    const app = createApp(testConfig(reader));
    const cookie = (await login(app)).headers.get("set-cookie") ?? "";

    const mailboxResponse = await app.request(
      "/api/mail-accounts/missing/mailboxes/INBOX/messages",
      { headers: { cookie } },
    );
    const unreadResponse = await app.request("/api/mail-accounts/missing/messages/unread", {
      headers: { cookie },
    });

    expect(mailboxResponse.status).toBe(404);
    expect(unreadResponse.status).toBe(404);
    expect(reader.listMailbox).not.toHaveBeenCalled();
    expect(reader.listUnread).not.toHaveBeenCalled();
  });

  it("manually refreshes only the selected account and current reader state", async () => {
    const refreshed: AccountRefreshResponse = {
      mailAccount: {
        ...emptyAccountOpen.mailAccount,
        mailboxes: [
          {
            id: "INBOX",
            name: "Inbox",
            path: "INBOX",
            systemRole: "inbox",
            unreadCount: 1,
            totalCount: 1,
            selectable: true,
          },
        ],
      },
      view: {
        kind: "mailbox",
        mailboxId: "INBOX",
        messages: mailboxPage.messages,
      },
      selectedMessageId: "gmail-message-2",
      selectedMessage: mailboxPage.messages[0],
    };
    const refreshAccount = vi.fn<GmailImapReader["refreshAccount"]>(async () => refreshed);
    const reader = testReader({ refreshAccount });
    const app = createApp(testConfig(reader));
    const cookie = (await login(app)).headers.get("set-cookie") ?? "";

    const response = await app.request("/api/mail-accounts/personal/refresh", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        view: { kind: "mailbox", mailboxId: "INBOX" },
        selectedMessageId: "gmail-message-2",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(refreshed);
    expect(refreshAccount).toHaveBeenCalledWith(
      {
        id: "personal",
        emailAddress: "me@example.com",
        appPassword: "personal-app-password",
      },
      {
        view: { kind: "mailbox", mailboxId: "INBOX" },
        selectedMessageId: "gmail-message-2",
      },
    );
    expect(reader.openAccount).not.toHaveBeenCalled();
    expect(reader.listMailbox).not.toHaveBeenCalled();
    expect(reader.listUnread).not.toHaveBeenCalled();
  });
});

function testReader(overrides: Partial<GmailImapReader> = {}): GmailImapReader {
  return {
    openAccount: vi.fn(async () => emptyAccountOpen),
    listMailbox: vi.fn(async () => ({ messages: [] })),
    listUnread: vi.fn(async () => ({ messages: [] })),
    refreshAccount: vi.fn(async () => ({
      mailAccount: emptyAccountOpen.mailAccount,
      view: { kind: "unread", messages: [] },
    })),
    closeAllSessions: vi.fn(async () => undefined),
    ...overrides,
  };
}

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
