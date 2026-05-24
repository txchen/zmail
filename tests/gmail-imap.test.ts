import { describe, expect, it, vi } from "vite-plus/test";
import { createGmailImapMailboxSyncClient } from "../apps/api/src/gmail-imap";

const connect = vi.fn();
const list = vi.fn();
const logout = vi.fn();

describe("Gmail IMAP mailbox sync client", () => {
  it("lists Gmail mailboxes with unread counts using the configured Mail account credential", async () => {
    const imapFlow = vi.fn(function () {
      return { connect, list, logout };
    });
    connect.mockResolvedValue(undefined);
    list.mockResolvedValue([
      { path: "INBOX", status: { unseen: 2 } },
      { path: "[Gmail]/Trash", status: { unseen: 0 } },
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
      { id: "INBOX", name: "INBOX", unreadCount: 2 },
      { id: "[Gmail]/Trash", name: "[Gmail]/Trash", unreadCount: 0 },
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
});
