import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createGmailImapMailboxSyncClient } from "../apps/api/src/gmail-imap";

const connect = vi.fn();
const list = vi.fn();
const mailboxOpen = vi.fn();
const fetch = vi.fn();
const messageFlagsAdd = vi.fn();
const messageFlagsRemove = vi.fn();
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
      { path: "INBOX", status: { unseen: 2, messages: 10, uidNext: 43 } },
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
      { id: "INBOX", name: "INBOX", unreadCount: 2, totalCount: 10, uidNext: 43, selectable: true },
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
    expect(list).toHaveBeenCalledWith({
      statusQuery: { unseen: true, messages: true, uidNext: true },
    });
    expect(logout).toHaveBeenCalledOnce();
  });

  it("lists recent Gmail Messages from visible mailboxes", async () => {
    const imapFlow = vi.fn(function () {
      return { connect, list, mailboxOpen, fetch, logout };
    });
    connect.mockResolvedValue(undefined);
    list.mockResolvedValue([
      { path: "INBOX", status: { unseen: 1 } },
      { path: "INBOX/Project", status: { unseen: 1 } },
      { path: "[Gmail]/All Mail", status: { unseen: 0 } },
      { path: "[Gmail]", flags: new Set(["\\Noselect"]), status: { unseen: 0 } },
    ]);
    mailboxOpen.mockResolvedValue({ exists: 42 });
    fetch.mockImplementation(async function* () {
      const mailboxId = mailboxOpen.mock.lastCall?.[0] ?? "INBOX";

      yield {
        uid: 42,
        emailId: `178abc-${mailboxId}`,
        threadId: "thread-1",
        flags: new Set(["\\Seen"]),
        envelope: {
          subject: "Hello",
          date: new Date("2026-05-23T10:00:00.000Z"),
          from: [{ address: "sender@example.com", name: "Sender" }],
          to: [{ address: "me@example.com" }],
          cc: [{ address: "copy@example.com", name: "Copy" }],
          bcc: [{ address: "hidden@example.com" }],
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

    const messages = await client.listRecentMessages({
      account: {
        id: "personal",
        emailAddress: "me@example.com",
        appPassword: "gmail-app-password",
      },
      mailboxes: [
        { id: "INBOX", since: new Date("2026-05-01T00:00:00.000Z") },
        { id: "INBOX/Project", since: new Date("2026-05-01T00:00:00.000Z") },
        { id: "[Gmail]/All Mail", since: new Date("2026-05-01T00:00:00.000Z") },
      ],
    });

    expect(messages.map((message) => message.mailboxIds)).toEqual([["INBOX"], ["INBOX/Project"]]);
    expect(messages[0]).toMatchObject({
      uid: 42,
      recipients: [{ address: "me@example.com" }],
      ccRecipients: [{ address: "copy@example.com", displayName: "Copy" }],
      bccRecipients: [{ address: "hidden@example.com" }],
      receivedAt: "2026-05-23T10:00:00.000Z",
    });
    expect(mailboxOpen).toHaveBeenCalledWith("INBOX");
    expect(mailboxOpen).toHaveBeenCalledWith("INBOX/Project");
    expect(mailboxOpen).not.toHaveBeenCalledWith("[Gmail]/All Mail");
    expect(mailboxOpen).not.toHaveBeenCalledWith("[Gmail]");
    expect(fetch).toHaveBeenCalledWith(
      "33:*",
      {
        uid: true,
        flags: true,
        envelope: true,
        internalDate: true,
        source: true,
        threadId: true,
      },
      { uid: false },
    );
    expect(logout).toHaveBeenCalledOnce();
  });

  it("filters initial Gmail backfill by header date instead of internal delivery date", async () => {
    const imapFlow = vi.fn(function () {
      return { connect, list, mailboxOpen, fetch, logout };
    });
    connect.mockResolvedValue(undefined);
    list.mockResolvedValue([{ path: "INBOX", status: { unseen: 1 } }]);
    mailboxOpen.mockResolvedValue({ exists: 42 });
    fetch.mockImplementation(async function* () {
      yield {
        uid: 42,
        emailId: "old-forwarded-spam",
        flags: new Set(["\\Seen"]),
        envelope: {
          subject: "Old forwarded spam",
          date: "Sun, 26 Sep 2021 17:47:21 CEST",
          from: [{ address: "vilnefolmart@gmail.com" }],
          to: [{ address: "John@aol.com" }],
        },
        internalDate: new Date("2026-05-24T21:06:29.207Z"),
        source: Buffer.from("Subject: Old forwarded spam\r\n\r\nBody"),
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
    ).resolves.toEqual([]);
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
        source: true,
        threadId: true,
      },
      { uid: true },
    );
  });

  it("marks Gmail Messages read by applying the Seen flag in a containing Mailbox", async () => {
    const imapFlow = vi.fn(function () {
      return { connect, mailboxOpen, messageFlagsAdd, logout };
    });
    connect.mockResolvedValue(undefined);
    mailboxOpen.mockResolvedValue({ exists: 42 });
    messageFlagsAdd.mockResolvedValue(true);
    logout.mockResolvedValue(undefined);

    const client = createGmailImapMailboxSyncClient(imapFlow);

    await client.markRead({
      accountId: "personal",
      emailAddress: "me@example.com",
      appPassword: "gmail-app-password",
      messageId: "178abc",
      mailboxIds: ["INBOX/Project", "INBOX"],
    });

    expect(mailboxOpen).toHaveBeenCalledWith("INBOX/Project");
    expect(messageFlagsAdd).toHaveBeenCalledWith({ emailId: "178abc" }, ["\\Seen"]);
    expect(logout).toHaveBeenCalledOnce();
  });

  it("marks Gmail Messages unread by UID when the local Message id contains a mailbox UID", async () => {
    const imapFlow = vi.fn(function () {
      return { connect, mailboxOpen, messageFlagsRemove, logout };
    });
    connect.mockResolvedValue(undefined);
    mailboxOpen.mockResolvedValue({ exists: 42 });
    messageFlagsRemove.mockResolvedValue(true);
    logout.mockResolvedValue(undefined);

    const client = createGmailImapMailboxSyncClient(imapFlow);

    await client.markUnread({
      accountId: "personal",
      emailAddress: "me@example.com",
      appPassword: "gmail-app-password",
      messageId: "INBOX/Project:42",
      mailboxIds: ["INBOX/Project"],
    });

    expect(mailboxOpen).toHaveBeenCalledWith("INBOX/Project");
    expect(messageFlagsRemove).toHaveBeenCalledWith("42", ["\\Seen"]);
    expect(logout).toHaveBeenCalledOnce();
  });
});
