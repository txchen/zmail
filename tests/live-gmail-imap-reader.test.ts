import { describe, expect, it, vi } from "vitest";
import { createGmailImapMailboxSyncClient } from "../apps/api/src/gmail-imap";
import {
  createImapSessionCoordinator,
  type ImapClientSession,
} from "../apps/api/src/imap-session-coordinator";
import { createGmailImapReader } from "../apps/api/src/live-imap";

describe("Gmail Live IMAP Account open mapping", () => {
  it("returns the last 50 Gmail arrival sequences newest-first without fetching bodies", async () => {
    const connect = vi.fn(async () => undefined);
    const list = vi.fn(async () => [
      {
        path: "INBOX",
        name: "INBOX",
        specialUse: "\\Inbox",
        flags: new Set<string>(),
        status: { unseen: 2, messages: 100 },
      },
      {
        path: "[Gmail]/All Mail",
        name: "All Mail",
        parentPath: "[Gmail]",
        specialUse: "\\All",
        flags: new Set<string>(),
        status: { unseen: 4, messages: 120 },
      },
    ]);
    const mailboxOpen = vi.fn(async () => ({ exists: 100, uidValidity: 1n }));
    const search = vi.fn(async () => [51, 100]);
    const fetch = vi.fn(async function* () {
      yield {
        seq: 51,
        uid: 51,
        emailId: "older-arrival",
        flags: new Set<string>(),
        envelope: {
          subject: "Misleading future Date header",
          date: new Date("2030-01-01T00:00:00.000Z"),
          from: [{ address: "first@example.com" }],
          to: [{ address: "me@example.com" }],
        },
      };
      yield {
        seq: 100,
        uid: 100,
        emailId: "newest-arrival",
        flags: new Set(["\\Seen", "\\Flagged"]),
        envelope: {
          subject: "Newest Gmail arrival",
          date: new Date("2020-01-01T00:00:00.000Z"),
          from: [{ address: "last@example.com" }],
          to: [{ address: "me@example.com" }],
        },
      };
    });
    const logout = vi.fn(async () => undefined);
    const ImapFlowClient = vi.fn(function () {
      return { connect, list, mailboxOpen, search, fetch, logout };
    });
    const reader = createGmailImapReader(ImapFlowClient);

    const response = await reader.openAccount({
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "gmail-app-password",
    });
    await reader.closeAllSessions();

    expect(ImapFlowClient).toHaveBeenCalledWith({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: {
        user: "me@example.com",
        pass: "gmail-app-password",
      },
      disableAutoIdle: true,
      logger: false,
    });
    expect(fetch).toHaveBeenCalledWith(
      "51,100",
      {
        flags: true,
        envelope: true,
        internalDate: true,
        threadId: true,
      },
      { uid: true },
    );
    expect(response.inbox.messages.map((message) => message.id)).toEqual([
      "newest-arrival",
      "older-arrival",
    ]);
    expect(response.mailAccount.unreadCount).toBe(4);
    expect(logout).toHaveBeenCalledOnce();
  });

  it("pages one Mailbox newest-first with an opaque cursor that cannot cross Mailboxes", async () => {
    const uids = Array.from({ length: 55 }, (_value, index) => index + 1);
    const connect = vi.fn(async () => undefined);
    const list = vi.fn(async () => [
      {
        path: "INBOX",
        specialUse: "\\Inbox",
        flags: new Set<string>(),
        status: { unseen: 0, messages: 55 },
      },
      {
        path: "[Gmail]/Sent",
        specialUse: "\\Sent",
        flags: new Set<string>(),
        status: { unseen: 0, messages: 55 },
      },
    ]);
    const mailboxOpen = vi.fn(async () => ({ exists: 55, uidValidity: 42n }));
    const search = vi.fn(async () => uids);
    const fetch = vi.fn(async function* (range: string) {
      for (const uid of range.split(",").map(Number).reverse()) {
        yield messageFixture(uid, `message-${uid}`);
      }
    });
    const logout = vi.fn(async () => undefined);
    const ImapFlowClient = vi.fn(function () {
      return { connect, list, mailboxOpen, search, fetch, logout };
    });
    const reader = createGmailImapReader(ImapFlowClient);
    const account = {
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "gmail-app-password",
    };

    const firstPage = await reader.listMailbox(account, "INBOX");
    const secondPage = await reader.listMailbox(account, "INBOX", firstPage.nextCursor);

    expect(firstPage.messages).toHaveLength(50);
    expect(firstPage.messages[0]?.id).toBe("message-55");
    expect(firstPage.messages[49]?.id).toBe("message-6");
    expect(firstPage.nextCursor).toBeTypeOf("string");
    expect(firstPage.nextCursor).not.toContain("INBOX");
    expect(secondPage.messages.map((message) => message.id)).toEqual([
      "message-5",
      "message-4",
      "message-3",
      "message-2",
      "message-1",
    ]);
    expect(secondPage.nextCursor).toBeUndefined();
    expect(search).toHaveBeenCalledWith({ all: true }, { uid: true });
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      {
        flags: true,
        envelope: true,
        internalDate: true,
        threadId: true,
      },
      { uid: true },
    );

    await expect(reader.listMailbox(account, "[Gmail]/Sent", firstPage.nextCursor)).rejects.toThrow(
      "Invalid cursor",
    );
  });

  it("reads Account unread from Gmail All Mail, excludes Spam and Trash, and deduplicates Messages", async () => {
    const connect = vi.fn(async () => undefined);
    const list = vi.fn(async () => [
      {
        path: "INBOX",
        specialUse: "\\Inbox",
        flags: new Set<string>(),
        status: { unseen: 3, messages: 10 },
      },
      {
        path: "[Gmail]/All Mail",
        specialUse: "\\All",
        flags: new Set<string>(),
        status: { unseen: 4, messages: 20 },
      },
      {
        path: "[Gmail]/Spam",
        specialUse: "\\Junk",
        flags: new Set<string>(),
        status: { unseen: 1, messages: 1 },
      },
      {
        path: "[Gmail]/Trash",
        specialUse: "\\Trash",
        flags: new Set<string>(),
        status: { unseen: 1, messages: 1 },
      },
    ]);
    const mailboxOpen = vi.fn(async () => ({ exists: 20, uidValidity: 73n }));
    const search = vi.fn(async () => [1, 2, 3, 4]);
    const fetch = vi.fn(async function* () {
      yield messageFixture(2, "unique-older");
      yield messageFixture(4, "duplicate");
      yield messageFixture(1, "oldest");
      yield messageFixture(3, "duplicate");
    });
    const logout = vi.fn(async () => undefined);
    const ImapFlowClient = vi.fn(function () {
      return { connect, list, mailboxOpen, search, fetch, logout };
    });
    const reader = createGmailImapReader(ImapFlowClient);

    const page = await reader.listUnread({
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "gmail-app-password",
    });

    expect(mailboxOpen).toHaveBeenCalledOnce();
    expect(mailboxOpen).toHaveBeenCalledWith("[Gmail]/All Mail", { readOnly: true });
    expect(search).toHaveBeenCalledWith(
      { seen: false, gmailRaw: "-in:spam -in:trash" },
      { uid: true },
    );
    expect(page.messages.map((message) => message.id)).toEqual([
      "duplicate",
      "unique-older",
      "oldest",
    ]);
  });

  it("manually refreshes one account tree and its current list in one coordinated operation", async () => {
    const connect = vi.fn(async () => undefined);
    const list = vi.fn(async () => [
      {
        path: "INBOX",
        name: "Inbox",
        specialUse: "\\Inbox",
        flags: new Set<string>(),
        status: { unseen: 1, messages: 1 },
      },
      {
        path: "[Gmail]/All Mail",
        name: "All Mail",
        specialUse: "\\All",
        flags: new Set<string>(),
        status: { unseen: 1, messages: 1 },
      },
    ]);
    let selectedMailbox = "";
    const mailboxOpen = vi.fn(async (path: string) => {
      selectedMailbox = path;
      return { exists: 2, uidValidity: 9n };
    });
    const search = vi.fn(async (query: { all?: true; emailId?: string }) => {
      if (!query.emailId) {
        return [2];
      }

      return selectedMailbox === "[Gmail]/All Mail" ? [1] : [];
    });
    const fetch = vi.fn(async function* (range: string) {
      yield range === "1" ? messageFixture(1, "selected") : messageFixture(2, "fresh");
    });
    const logout = vi.fn(async () => undefined);
    const ImapFlowClient = vi.fn(function () {
      return { connect, list, mailboxOpen, search, fetch, logout };
    });
    const reader = createGmailImapReader(ImapFlowClient);

    const response = await reader.refreshAccount(
      {
        id: "personal",
        emailAddress: "me@example.com",
        appPassword: "gmail-app-password",
      },
      {
        view: { kind: "mailbox", mailboxId: "INBOX" },
        selectedMessageId: "selected",
      },
    );

    expect(connect).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledOnce();
    expect(response.mailAccount.unreadCount).toBe(1);
    expect(response.view).toMatchObject({
      kind: "mailbox",
      mailboxId: "INBOX",
      messages: [{ id: "fresh" }],
    });
    expect(response.selectedMessage?.id).toBe("selected");
    expect(search).toHaveBeenCalledWith({ emailId: "selected" }, { uid: true });
    expect(mailboxOpen).toHaveBeenCalledWith("[Gmail]/All Mail", { readOnly: true });
  });

  it("explicitly reports a selected Message that is no longer visible in the account", async () => {
    const connect = vi.fn(async () => undefined);
    const list = vi.fn(async () => [
      {
        path: "INBOX",
        specialUse: "\\Inbox",
        flags: new Set<string>(),
        status: { unseen: 0, messages: 1 },
      },
      {
        path: "[Gmail]/All Mail",
        specialUse: "\\All",
        flags: new Set<string>(),
        status: { unseen: 0, messages: 1 },
      },
      {
        path: "[Gmail]/Spam",
        specialUse: "\\Junk",
        flags: new Set<string>(),
        status: { unseen: 0, messages: 0 },
      },
      {
        path: "[Gmail]/Trash",
        specialUse: "\\Trash",
        flags: new Set<string>(),
        status: { unseen: 0, messages: 0 },
      },
    ]);
    const mailboxOpen = vi.fn(async () => ({ exists: 1, uidValidity: 9n }));
    const search = vi.fn(async (query: { all?: true; emailId?: string }) =>
      query.emailId ? [] : [1],
    );
    const fetch = vi.fn(async function* () {
      yield messageFixture(1, "fresh");
    });
    const logout = vi.fn(async () => undefined);
    const ImapFlowClient = vi.fn(function () {
      return { connect, list, mailboxOpen, search, fetch, logout };
    });
    const reader = createGmailImapReader(ImapFlowClient);

    const response = await reader.refreshAccount(
      {
        id: "personal",
        emailAddress: "me@example.com",
        appPassword: "gmail-app-password",
      },
      {
        view: { kind: "mailbox", mailboxId: "INBOX" },
        selectedMessageId: "gone",
      },
    );

    expect(response.selectedMessageId).toBe("gone");
    expect(response.selectedMessage).toBeUndefined();
    expect(mailboxOpen).toHaveBeenCalledWith("[Gmail]/All Mail", { readOnly: true });
    expect(mailboxOpen).toHaveBeenCalledWith("[Gmail]/Spam", { readOnly: true });
    expect(mailboxOpen).toHaveBeenCalledWith("[Gmail]/Trash", { readOnly: true });
  });

  it("serializes Live IMAP and retained legacy operations through one account session", async () => {
    const firstListCanFinish = Promise.withResolvers<void>();
    let listCallCount = 0;
    const list = vi.fn(async () => {
      listCallCount += 1;

      if (listCallCount === 1) {
        await firstListCanFinish.promise;
        return [
          {
            path: "INBOX",
            specialUse: "\\Inbox",
            flags: new Set<string>(),
            status: { unseen: 0, messages: 0 },
          },
        ];
      }

      return [];
    });
    const connect = vi.fn(async () => undefined);
    const mailboxOpen = vi.fn(async () => ({ exists: 0 }));
    const logout = vi.fn(async () => undefined);
    const ImapFlowClient = vi.fn(function () {
      return { connect, list, mailboxOpen, logout };
    });
    const coordinator = createImapSessionCoordinator<ImapClientSession>();
    const liveReader = createGmailImapReader(ImapFlowClient, coordinator);
    const legacyReader = createGmailImapMailboxSyncClient(ImapFlowClient, coordinator);
    const account = {
      id: "personal",
      emailAddress: "me@example.com",
      appPassword: "gmail-app-password",
    };

    const liveOpen = liveReader.openAccount(account);
    await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
    const legacyList = legacyReader.listVisibleMailboxes(account);

    expect(ImapFlowClient).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledOnce();
    firstListCanFinish.resolve();
    await Promise.all([liveOpen, legacyList]);
    await liveReader.closeAllSessions();

    expect(ImapFlowClient).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledTimes(2);
    expect(logout).toHaveBeenCalledOnce();
  });
});

function messageFixture(uid: number, emailId: string) {
  return {
    uid,
    emailId,
    flags: new Set<string>(),
    envelope: {
      subject: `Message ${emailId}`,
      date: new Date(uid * 1_000),
      from: [{ address: "sender@example.com" }],
      to: [{ address: "me@example.com" }],
    },
  };
}
