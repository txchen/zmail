import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createGmailImapMailboxSyncClient } from "../apps/api/src/gmail-imap";

const connect = vi.fn();
const list = vi.fn();
const mailboxOpen = vi.fn();
const fetch = vi.fn();
const logout = vi.fn();

describe("Gmail IMAP mailbox sync client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists Gmail mailboxes with unread counts using the configured Mail account credential", async () => {
    const imapFlow = vi.fn(function () {
      return { connect, list, logout };
    });
    connect.mockResolvedValue(undefined);
    list.mockResolvedValue([
      { path: "INBOX", status: { unseen: 2 } },
      { path: "[Gmail]", flags: new Set(["\\Noselect"]), status: { unseen: 0 } },
    ]);
    logout.mockResolvedValue(undefined);

    const client = createGmailImapMailboxSyncClient(imapFlow);

    await expect(
      client.listVisibleMailboxes({
        id: "personal",
        emailAddress: "me@example.com",
        appPassword: "gmail-app-password",
      }),
    ).resolves.toEqual([
      { id: "INBOX", name: "INBOX", unreadCount: 2, selectable: true },
      { id: "[Gmail]", name: "[Gmail]", unreadCount: 0, selectable: false },
    ]);

    expect(imapFlow).toHaveBeenCalledWith({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: {
        user: "me@example.com",
        pass: "gmail-app-password",
      },
      logger: false,
    });
    expect(connect).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledWith({ statusQuery: { unseen: true } });
    expect(logout).toHaveBeenCalledOnce();
  });

  it("lists recent Gmail Messages from visible mailboxes", async () => {
    const imapFlow = vi.fn(function () {
      return { connect, list, mailboxOpen, fetch, logout };
    });
    connect.mockResolvedValue(undefined);
    list.mockResolvedValue([
      { path: "INBOX", status: { unseen: 1 } },
      { path: "[Gmail]", flags: new Set(["\\Noselect"]), status: { unseen: 0 } },
    ]);
    mailboxOpen.mockResolvedValue({ exists: 42 });
    fetch.mockImplementation(async function* () {
      yield {
        uid: 42,
        emailId: "178abc",
        threadId: "thread-1",
        flags: new Set(["\\Seen"]),
        envelope: {
          subject: "Hello",
          date: new Date("2026-05-23T10:00:00.000Z"),
          from: [{ address: "sender@example.com", name: "Sender" }],
          to: [{ address: "me@example.com" }],
        },
        source: Buffer.from(
          [
            "Subject: Hello",
            "From: Sender <sender@example.com>",
            "To: me@example.com",
            "",
            "Plain body",
          ].join("\r\n"),
        ),
      };
    });
    logout.mockResolvedValue(undefined);

    const client = createGmailImapMailboxSyncClient(imapFlow);

    await expect(
      client.listRecentMessages({
        account: {
          id: "personal",
          emailAddress: "me@example.com",
          appPassword: "gmail-app-password",
        },
        mailboxes: [{ id: "INBOX", since: new Date("2026-05-01T00:00:00.000Z") }],
      }),
    ).resolves.toEqual([
      {
        id: "178abc",
        stableIdentity: "gmail:personal:178abc",
        threadId: "thread-1",
        subject: "Hello",
        sender: { address: "sender@example.com", displayName: "Sender" },
        recipients: [{ address: "me@example.com" }],
        receivedAt: "2026-05-23T10:00:00.000Z",
        unread: false,
        snippet: "Plain body",
        readableBody: "Plain body",
        plainTextBody: "Plain body",
        attachments: [],
        mailboxIds: ["INBOX"],
      },
    ]);
    expect(mailboxOpen).toHaveBeenCalledWith("INBOX");
    expect(mailboxOpen).not.toHaveBeenCalledWith("[Gmail]");
    expect(fetch).toHaveBeenCalledWith(
      "33:*",
      {
        uid: true,
        flags: true,
        envelope: true,
        internalDate: true,
        source: { maxLength: 16384 },
        threadId: true,
      },
      { uid: true },
    );
    expect(logout).toHaveBeenCalledOnce();
  });

  it("fetches Gmail Messages after a saved Mailbox UID checkpoint", async () => {
    const imapFlow = vi.fn(function () {
      return { connect, list, mailboxOpen, fetch, logout };
    });
    connect.mockResolvedValue(undefined);
    list.mockResolvedValue([{ path: "INBOX", status: { unseen: 1 } }]);
    mailboxOpen.mockResolvedValue({ exists: 42 });
    fetch.mockImplementation(async function* () {});
    logout.mockResolvedValue(undefined);

    const client = createGmailImapMailboxSyncClient(imapFlow);

    await client.listRecentMessages({
      account: {
        id: "personal",
        emailAddress: "me@example.com",
        appPassword: "gmail-app-password",
      },
      mailboxes: [{ id: "INBOX", afterUid: 42 }],
    });

    expect(fetch).toHaveBeenCalledWith(
      "43:*",
      {
        uid: true,
        flags: true,
        envelope: true,
        internalDate: true,
        source: { maxLength: 16384 },
        threadId: true,
      },
      { uid: true },
    );
  });
});
