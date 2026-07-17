import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
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

describe("Gmail Live IMAP Message content mapping", () => {
  it("locates a Message by X-GM-MSGID across All Mail, Spam, and Trash and peeks only body text", async () => {
    let selectedMailbox = "";
    const list = vi.fn(async () => messageMailboxes());
    const mailboxOpen = vi.fn(async (path: string) => {
      selectedMailbox = path;
      return { exists: 1, uidValidity: 1n };
    });
    const search = vi.fn(async () => (selectedMailbox === "[Gmail]/Trash" ? [42] : []));
    const fetchOne = vi
      .fn()
      .mockResolvedValueOnce(messageStructureFixture())
      .mockResolvedValueOnce({
        uid: 42,
        bodyParts: new Map([
          ["1", Buffer.from("Plain fallback")],
          ["2", Buffer.from('<p>Hello <img src="cid:logo@example.com"></p>')],
        ]),
      });
    const download = vi.fn();
    const logout = vi.fn(async () => undefined);
    const ImapFlowClient = vi.fn(function () {
      return {
        connect: vi.fn(async () => undefined),
        list,
        mailboxOpen,
        search,
        fetchOne,
        download,
        logout,
      };
    });
    const reader = createGmailImapReader(ImapFlowClient);

    const result = await reader.readMessage(accountFixture(), "1876543210");
    await reader.closeAllSessions();

    expect(mailboxOpen.mock.calls.map(([path]) => path)).toEqual([
      "[Gmail]/All Mail",
      "[Gmail]/Spam",
      "[Gmail]/Trash",
    ]);
    expect(search).toHaveBeenCalledTimes(3);
    expect(search).toHaveBeenLastCalledWith({ emailId: "1876543210" }, { uid: true });
    expect(fetchOne).toHaveBeenNthCalledWith(
      1,
      "42",
      {
        flags: true,
        envelope: true,
        internalDate: true,
        threadId: true,
        bodyStructure: true,
      },
      { uid: true },
    );
    expect(fetchOne).toHaveBeenNthCalledWith(2, "42", { bodyParts: ["1", "2"] }, { uid: true });
    expect(download).not.toHaveBeenCalled();
    expect(result).toEqual({
      accountId: "personal",
      id: "1876543210",
      threadId: "thread-1",
      subject: "Live Message",
      sender: { address: "sender@example.com", displayName: "Sender" },
      recipients: [{ address: "me@example.com" }],
      ccRecipients: [{ address: "copy@example.com" }],
      bccRecipients: [],
      receivedAt: "2026-07-17T12:00:00.000Z",
      unread: true,
      starred: true,
      readableBody: '<p>Hello <img src="cid:logo@example.com"></p>',
      plainTextBody: "Plain fallback",
      inlineResources: [
        {
          id: "Mw",
          contentId: "logo@example.com",
          mimeType: "image/png",
          sizeBytes: 3,
        },
      ],
      attachments: [
        {
          id: "NA",
          filename: "agenda.pdf",
          mimeType: "application/pdf",
          sizeBytes: 4,
        },
      ],
    });
  });

  it("peeks one Inline message resource without writing it to disk or server cache", async () => {
    const client = contentClient({
      download: vi.fn(async () => ({
        meta: { expectedSize: 3, contentType: "image/png" },
        content: Readable.from([Buffer.from([1, 2, 3])]),
      })),
    });
    const ImapFlowClient = vi.fn(function () {
      return client;
    });
    const reader = createGmailImapReader(ImapFlowClient);

    const resource = await reader.readInlineResource(accountFixture(), "1876543210", "Mw");
    await reader.closeAllSessions();

    expect(client.download).toHaveBeenCalledWith("42", "3", { uid: true });
    expect(resource).toEqual({
      mimeType: "image/png",
      bytes: Uint8Array.from([1, 2, 3]),
    });
  });

  it("keeps attached Messages out of the Readable body and accepts CID resources without disposition", async () => {
    const structure = messageStructureFixture();
    structure.bodyStructure.childNodes = [
      {
        part: "1",
        type: "text/html",
        id: "<related-root@example.com>",
        parameters: { charset: "utf-8" },
        encoding: "7bit",
        size: 18,
      },
      {
        part: "2",
        type: "message/rfc822",
        disposition: "attachment",
        dispositionParameters: { filename: "forwarded.eml" },
        size: 80,
        childNodes: [
          {
            part: "2.1",
            type: "text/html",
            parameters: { charset: "utf-8" },
            encoding: "7bit",
            size: 28,
          },
        ],
      },
      {
        part: "3",
        type: "image/png",
        id: "<logo@example.com>",
        encoding: "base64",
        size: 3,
      },
    ];
    const client = contentClient();
    client.fetchOne = vi
      .fn()
      .mockResolvedValueOnce(structure)
      .mockResolvedValueOnce({
        uid: 42,
        bodyParts: new Map([
          ["1", Buffer.from("<p>Actual body</p>")],
          ["2.1", Buffer.from("<p>Attached body</p>")],
        ]),
      });
    const ImapFlowClient = vi.fn(function () {
      return client;
    });
    const reader = createGmailImapReader(ImapFlowClient);

    const detail = await reader.readMessage(accountFixture(), "1876543210");

    expect(client.fetchOne).toHaveBeenNthCalledWith(2, "42", { bodyParts: ["1"] }, { uid: true });
    expect(detail?.readableBody).toBe("<p>Actual body</p>");
    expect(detail?.inlineResources).toEqual([
      {
        id: "Mw",
        contentId: "logo@example.com",
        mimeType: "image/png",
        sizeBytes: 3,
      },
    ]);
    expect(detail?.attachments).toEqual([
      {
        id: "Mg",
        filename: "forwarded.eml",
        mimeType: "message/rfc822",
        sizeBytes: 80,
      },
    ]);
    await reader.closeAllSessions();
  });

  it("closes an independent bounded Attachment session after stream completion", async () => {
    const ordinaryClient = contentClient();
    const attachmentClient = contentClient({
      download: vi.fn(async () => ({
        meta: {
          expectedSize: 4,
          contentType: "application/pdf",
          filename: "agenda.pdf",
        },
        content: Readable.from([Buffer.from([4, 5]), Buffer.from([6, 7])]),
      })),
    });
    let clientCount = 0;
    const ImapFlowClient = vi.fn(function () {
      clientCount += 1;
      return clientCount === 1 ? ordinaryClient : attachmentClient;
    });
    const reader = createGmailImapReader(ImapFlowClient);
    const detail = await reader.readMessage(accountFixture(), "1876543210");
    const attachment = await reader.downloadAttachment(
      accountFixture(),
      "1876543210",
      detail?.attachments[0]?.id ?? "",
    );

    expect(attachmentClient.logout).not.toHaveBeenCalled();
    expect(new Uint8Array(await new Response(attachment?.body).arrayBuffer())).toEqual(
      Uint8Array.from([4, 5, 6, 7]),
    );
    expect(attachmentClient.download).toHaveBeenCalledWith("42", "4", {
      uid: true,
      maxBytes: 4,
    });
    expect(attachmentClient.logout).toHaveBeenCalledOnce();
    expect(ImapFlowClient).toHaveBeenLastCalledWith(
      expect.objectContaining({ socketTimeout: 30_000, disableAutoIdle: true }),
    );
    await reader.closeAllSessions();
  });

  it("closes an independent Attachment session when the browser cancels the stream", async () => {
    const attachmentClient = contentClient({
      download: vi.fn(async () => ({
        meta: {
          expectedSize: 8,
          contentType: "application/octet-stream",
          filename: "large.bin",
        },
        content: Readable.from(
          (async function* () {
            yield Buffer.from([1, 2]);
            await new Promise(() => undefined);
          })(),
        ),
      })),
    });
    const ImapFlowClient = vi.fn(function () {
      return attachmentClient;
    });
    const reader = createGmailImapReader(ImapFlowClient);

    const attachment = await reader.downloadAttachment(accountFixture(), "1876543210", "NA");
    const streamReader = attachment?.body.getReader();
    await streamReader?.read();
    await streamReader?.cancel();

    await vi.waitFor(() => expect(attachmentClient.logout).toHaveBeenCalledOnce());
  });

  it("closes an independent Attachment session when streaming fails", async () => {
    const attachmentClient = contentClient({
      download: vi.fn(async () => ({
        meta: {
          expectedSize: 4,
          contentType: "application/octet-stream",
          filename: "broken.bin",
        },
        content: new Readable({
          read() {
            this.destroy(new Error("Gmail stream failed"));
          },
        }),
      })),
    });
    const ImapFlowClient = vi.fn(function () {
      return attachmentClient;
    });
    const reader = createGmailImapReader(ImapFlowClient);

    const attachment = await reader.downloadAttachment(accountFixture(), "1876543210", "NA");

    await expect(attachment?.body.getReader().read()).rejects.toThrow("Gmail stream failed");
    await vi.waitFor(() => expect(attachmentClient.logout).toHaveBeenCalledOnce());
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

function accountFixture() {
  return {
    id: "personal",
    emailAddress: "me@example.com",
    appPassword: "gmail-app-password",
  };
}

function messageMailboxes() {
  return [
    {
      path: "[Gmail]/All Mail",
      specialUse: "\\All",
      flags: new Set<string>(),
      status: { unseen: 1, messages: 1 },
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
      status: { unseen: 0, messages: 1 },
    },
  ];
}

function messageStructureFixture() {
  return {
    uid: 42,
    emailId: "1876543210",
    threadId: "thread-1",
    flags: new Set(["\\Flagged"]),
    envelope: {
      subject: "Live Message",
      date: new Date("2026-07-17T12:00:00.000Z"),
      from: [{ address: "sender@example.com", name: "Sender" }],
      to: [{ address: "me@example.com" }],
      cc: [{ address: "copy@example.com" }],
      bcc: [],
    },
    bodyStructure: {
      type: "multipart/mixed",
      childNodes: [
        {
          part: "1",
          type: "text/plain",
          parameters: { charset: "utf-8" },
          encoding: "7bit",
          size: 14,
        },
        {
          part: "2",
          type: "text/html",
          parameters: { charset: "utf-8" },
          encoding: "7bit",
          size: 52,
        },
        {
          part: "3",
          type: "image/png",
          id: "<logo@example.com>",
          disposition: "inline",
          encoding: "base64",
          size: 3,
        },
        {
          part: "4",
          type: "application/pdf",
          disposition: "attachment",
          dispositionParameters: { filename: "agenda.pdf" },
          encoding: "base64",
          size: 4,
        },
      ],
    },
  };
}

function contentClient(overrides: Record<string, unknown> = {}) {
  let selectedMailbox = "";
  return {
    connect: vi.fn(async () => undefined),
    list: vi.fn(async () => messageMailboxes()),
    mailboxOpen: vi.fn(async (path: string) => {
      selectedMailbox = path;
      return { exists: 1, uidValidity: 1n };
    }),
    search: vi.fn(async () => (selectedMailbox === "[Gmail]/All Mail" ? [42] : [])),
    fetchOne: vi
      .fn()
      .mockResolvedValueOnce(messageStructureFixture())
      .mockResolvedValueOnce({
        uid: 42,
        bodyParts: new Map([
          ["1", Buffer.from("Plain fallback")],
          ["2", Buffer.from('<p>Hello <img src="cid:logo@example.com"></p>')],
        ]),
      }),
    download: vi.fn(),
    logout: vi.fn(async () => undefined),
    ...overrides,
  };
}
