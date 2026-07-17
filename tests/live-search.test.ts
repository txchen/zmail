import type { AccountOpenResponse, LiveMessagePage } from "../packages/shared/src";
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
  inbox: { mailboxId: "INBOX", messages: [] },
};

const page: LiveMessagePage = {
  messages: [
    {
      accountId: "personal",
      id: "gmail-message-1",
      subject: "Invoice",
      sender: { address: "sender@example.com" },
      recipients: [{ address: "me@example.com" }],
      receivedAt: "2026-07-17T12:00:00.000Z",
      unread: true,
      starred: false,
    },
  ],
  nextCursor: "opaque-search-page",
};

describe("Live IMAP Search API", () => {
  it("submits one native Gmail query to only the selected account", async () => {
    const search = vi.fn<GmailImapReader["search"]>(async () => page);
    const app = createApp(testConfig(testReader({ search })));
    const cookie = (await login(app)).headers.get("set-cookie") ?? "";

    const response = await app.request(
      "/api/mail-accounts/personal/messages/search?q=%20from%3Abilling%40example.com%20in%3Aanywhere%20&cursor=opaque-current-page",
      { headers: { cookie } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(page);
    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith(
      {
        id: "personal",
        emailAddress: "me@example.com",
        appPassword: "personal-app-password",
      },
      " from:billing@example.com in:anywhere ",
      "opaque-current-page",
    );
  });

  it("rejects empty queries and unknown accounts without accessing Gmail", async () => {
    const reader = testReader();
    const app = createApp(testConfig(reader));
    const cookie = (await login(app)).headers.get("set-cookie") ?? "";

    const empty = await app.request("/api/mail-accounts/personal/messages/search?q=%20%20", {
      headers: { cookie },
    });
    const missing = await app.request("/api/mail-accounts/missing/messages/search?q=invoice", {
      headers: { cookie },
    });

    expect(empty.status).toBe(400);
    expect(missing.status).toBe(404);
    expect(reader.search).not.toHaveBeenCalled();
  });

  it("does not write native query text to error logs", async () => {
    const search = vi.fn<GmailImapReader["search"]>(async () => {
      throw new Error("Gmail rejected X-GM-RAW");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = createApp(testConfig(testReader({ search })));
    const cookie = (await login(app)).headers.get("set-cookie") ?? "";

    const response = await app.request(
      "/api/mail-accounts/personal/messages/search?q=private-secret-query",
      { headers: { cookie } },
    );

    expect(response.status).toBe(502);
    expect(log.mock.calls.flat().join(" ")).not.toContain("private-secret-query");
    log.mockRestore();
  });
});

function testReader(overrides: Partial<GmailImapReader> = {}): GmailImapReader {
  return {
    openAccount: vi.fn(async () => emptyAccountOpen),
    listMailbox: vi.fn(async () => ({ messages: [] })),
    listUnread: vi.fn(async () => ({ messages: [] })),
    search: vi.fn(async () => ({ messages: [] })),
    refreshAccount: vi.fn(async () => ({
      mailAccount: emptyAccountOpen.mailAccount,
      view: { kind: "unread", messages: [] },
    })),
    readMessage: vi.fn(async () => undefined),
    readInlineResource: vi.fn(async () => undefined),
    downloadAttachment: vi.fn(async () => undefined),
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
