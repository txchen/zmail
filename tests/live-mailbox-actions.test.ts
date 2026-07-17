import { describe, expect, it, vi } from "vite-plus/test";
import { createApp } from "../apps/api/src/app";
import type { GmailImapReader } from "../apps/api/src/live-imap";

describe("Live IMAP Mailbox actions API", () => {
  it.each(["markRead", "markUnread", "star", "unstar", "archive", "delete"] as const)(
    "submits the explicit %s target state once and returns Gmail confirmation",
    async (action) => {
      const performMailboxAction = vi.fn<GmailImapReader["performMailboxAction"]>(async () =>
        confirmation(action),
      );
      const app = createApp(testConfig(testReader({ performMailboxAction })));
      const cookie = (await login(app)).headers.get("set-cookie") ?? "";

      const response = await app.request(
        "/api/mail-accounts/personal/messages/gmail-message-1/actions",
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(confirmation(action));
      expect(performMailboxAction).toHaveBeenCalledOnce();
      expect(performMailboxAction).toHaveBeenCalledWith(
        {
          id: "personal",
          emailAddress: "me@example.com",
          appPassword: "personal-app-password",
        },
        "gmail-message-1",
        action,
      );
    },
  );

  it("reports an uncertain result without automatically rereading or retrying Gmail", async () => {
    const performMailboxAction = vi.fn<GmailImapReader["performMailboxAction"]>(async () => {
      throw new Error("connection closed after STORE");
    });
    const reader = testReader({ performMailboxAction });
    const app = createApp(testConfig(reader));
    const cookie = (await login(app)).headers.get("set-cookie") ?? "";

    const response = await app.request(
      "/api/mail-accounts/personal/messages/gmail-message-1/actions",
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ action: "markRead" }),
      },
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error:
        "Gmail did not confirm the Mailbox action. Refresh to verify or safely repeat the same target-state action.",
    });
    expect(performMailboxAction).toHaveBeenCalledOnce();
    expect(reader.readMessage).not.toHaveBeenCalled();
    expect(reader.refreshAccount).not.toHaveBeenCalled();
  });
});

function testReader(overrides: Partial<GmailImapReader> = {}): GmailImapReader {
  return {
    openAccount: vi.fn(),
    listMailbox: vi.fn(),
    listUnread: vi.fn(),
    search: vi.fn(),
    refreshAccount: vi.fn(),
    readMessage: vi.fn(),
    readInlineResource: vi.fn(),
    downloadAttachment: vi.fn(),
    performMailboxAction: vi.fn(async (_account, _messageId, action) => confirmation(action)),
    closeAllSessions: vi.fn(async () => undefined),
    ...overrides,
  };
}

function confirmation(action: Parameters<GmailImapReader["performMailboxAction"]>[2]) {
  const before = {
    unread: true,
    starred: false,
    mailboxIds: ["INBOX", "[Gmail]/All Mail"],
    systemMailboxRoles: ["inbox", "allMail"] as const,
  };
  return {
    accountId: "personal",
    messageId: "gmail-message-1",
    action,
    before: { ...before, systemMailboxRoles: [...before.systemMailboxRoles] },
    after: {
      unread: action === "markRead" ? false : true,
      starred: action === "star",
      mailboxIds:
        action === "archive"
          ? ["[Gmail]/All Mail"]
          : action === "delete"
            ? ["[Gmail]/Trash"]
            : [...before.mailboxIds],
      systemMailboxRoles:
        action === "archive"
          ? ["allMail" as const]
          : action === "delete"
            ? ["trash" as const]
            : [...before.systemMailboxRoles],
    },
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
