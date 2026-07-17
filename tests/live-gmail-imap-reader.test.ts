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
    const mailboxOpen = vi.fn(async () => ({ exists: 100 }));
    const fetch = vi.fn(async function* () {
      yield {
        seq: 51,
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
      return { connect, list, mailboxOpen, fetch, logout };
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
    expect(fetch).toHaveBeenCalledWith("51:100", {
      flags: true,
      envelope: true,
      internalDate: true,
      threadId: true,
    });
    expect(response.inbox.messages.map((message) => message.id)).toEqual([
      "newest-arrival",
      "older-arrival",
    ]);
    expect(response.mailAccount.unreadCount).toBe(4);
    expect(logout).toHaveBeenCalledOnce();
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
