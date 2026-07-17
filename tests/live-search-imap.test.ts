import { describe, expect, it, vi } from "vite-plus/test";
import { createGmailImapReader } from "../apps/api/src/live-imap";

const account = {
  id: "personal",
  emailAddress: "me@example.com",
  appPassword: "gmail-app-password",
};

describe("Gmail Live IMAP Search mapping", () => {
  it("serially checks All Mail, Spam, and Trash with the unchanged X-GM-RAW query", async () => {
    const events: string[] = [];
    let mailbox = "";
    const fixtures = {
      "[Gmail]/All Mail": [
        message(1, "all-only", "2026-07-17T10:00:00.000Z"),
        message(2, "duplicate", "2026-07-17T11:00:00.000Z"),
      ],
      "[Gmail]/Spam": [
        message(3, "spam-only", "2026-07-17T12:00:00.000Z"),
        message(4, "duplicate", "2026-07-17T11:00:00.000Z"),
      ],
      "[Gmail]/Trash": [message(5, "trash-only", "2026-07-17T09:00:00.000Z")],
    };
    const mailboxOpen = vi.fn(async (path: string) => {
      events.push(`open:${path}`);
      mailbox = path;
      return { exists: fixtures[path as keyof typeof fixtures].length, uidValidity: 1n };
    });
    const search = vi.fn(async (criteria: { gmailRaw?: string }) => {
      events.push(`search:${mailbox}:${criteria.gmailRaw}`);
      return fixtures[mailbox as keyof typeof fixtures].map((item) => item.uid);
    });
    const fetch = vi.fn(async function* (range: string) {
      events.push(`fetch:${mailbox}`);
      const requested = new Set(range.split(",").map(Number));
      yield* fixtures[mailbox as keyof typeof fixtures].filter((item) => requested.has(item.uid));
    });
    const reader = createGmailImapReader(fakeImapFlowClient({ mailboxOpen, search, fetch }));

    const page = await reader.search(account, " from:sender in:anywhere ");

    expect(events).toEqual([
      "open:[Gmail]/All Mail",
      "search:[Gmail]/All Mail: from:sender in:anywhere ",
      "fetch:[Gmail]/All Mail",
      "open:[Gmail]/Spam",
      "search:[Gmail]/Spam: from:sender in:anywhere ",
      "fetch:[Gmail]/Spam",
      "open:[Gmail]/Trash",
      "search:[Gmail]/Trash: from:sender in:anywhere ",
      "fetch:[Gmail]/Trash",
    ]);
    expect(page.messages.map((item) => item.id)).toEqual([
      "spam-only",
      "duplicate",
      "all-only",
      "trash-only",
    ]);
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
  });

  it("excludes Spam and Trash unless the native query explicitly selects their scope", async () => {
    let mailbox = "";
    const mailboxOpen = vi.fn(async (path: string) => {
      mailbox = path;
      return { exists: 1, uidValidity: 1n };
    });
    const search = vi.fn(async () => [1]);
    const fetch = vi.fn(async function* () {
      yield message(
        1,
        mailbox.includes("Spam") ? "spam" : mailbox.includes("Trash") ? "trash" : "all",
        "2026-07-17T12:00:00.000Z",
      );
    });
    const reader = createGmailImapReader(fakeImapFlowClient({ mailboxOpen, search, fetch }));

    const ordinary = await reader.search(account, "invoice");
    const spam = await reader.search(account, "invoice in:spam");
    const trash = await reader.search(account, "IN:TRASH invoice");
    const quoted = await reader.search(account, '"in:anywhere" invoice');
    const negated = await reader.search(account, "-in:spam invoice");

    expect(ordinary.messages.map((item) => item.id)).toEqual(["all"]);
    expect(spam.messages.map((item) => item.id)).toEqual(["spam", "all"]);
    expect(trash.messages.map((item) => item.id)).toEqual(["trash", "all"]);
    expect(quoted.messages.map((item) => item.id)).toEqual(["all"]);
    expect(negated.messages.map((item) => item.id)).toEqual(["all"]);
    expect(search).toHaveBeenCalledTimes(15);
  });

  it("returns stable metadata-only pages of at most 50 through an opaque query-bound cursor", async () => {
    let mailbox = "";
    const allMessages = Array.from({ length: 55 }, (_value, index) =>
      message(
        index + 1,
        `message-${index + 1}`,
        index === 0
          ? "2026-01-02T00:00:00.000Z"
          : new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      ),
    );
    const mailboxOpen = vi.fn(async (path: string) => {
      mailbox = path;
      return { exists: mailbox.includes("All Mail") ? 55 : 0, uidValidity: 42n };
    });
    const search = vi.fn(async () =>
      mailbox.includes("All Mail") ? allMessages.map((item) => item.uid) : [],
    );
    const fetch = vi.fn(async function* (range: string) {
      const requested = new Set(range.split(",").map(Number));
      yield* allMessages.filter((item) => requested.has(item.uid));
    });
    const reader = createGmailImapReader(fakeImapFlowClient({ mailboxOpen, search, fetch }));

    const first = await reader.search(account, "has:attachment");
    allMessages.push(message(56, "new-after-first-page", "2026-01-03T00:00:00.000Z"));
    const second = await reader.search(account, "has:attachment", first.nextCursor);

    expect(first.messages).toHaveLength(50);
    expect(first.messages[0]?.id).toBe("message-1");
    expect(first.messages[1]?.id).toBe("message-55");
    expect(first.nextCursor).toBeTypeOf("string");
    expect(first.nextCursor).not.toContain("has:attachment");
    expect(second.messages.map((item) => item.id)).toEqual([
      "message-6",
      "message-5",
      "message-4",
      "message-3",
      "message-2",
    ]);
    expect(second.nextCursor).toBeUndefined();
    await expect(reader.search(account, "different", first.nextCursor)).rejects.toThrow(
      "Invalid cursor",
    );
  });
});

function fakeImapFlowClient(overrides: {
  mailboxOpen: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
}) {
  return vi.fn(function () {
    return {
      connect: vi.fn(async () => undefined),
      list: vi.fn(async () => [
        {
          path: "[Gmail]/All Mail",
          specialUse: "\\All",
          flags: new Set<string>(),
          status: { unseen: 0, messages: 55 },
        },
        {
          path: "[Gmail]/Spam",
          specialUse: "\\Junk",
          flags: new Set<string>(),
          status: { unseen: 0, messages: 1 },
        },
        {
          path: "[Gmail]/Trash",
          specialUse: "\\Trash",
          flags: new Set<string>(),
          status: { unseen: 0, messages: 1 },
        },
      ]),
      ...overrides,
      logout: vi.fn(async () => undefined),
    };
  });
}

function message(uid: number, emailId: string, receivedAt: string) {
  return {
    uid,
    emailId,
    flags: new Set<string>(),
    envelope: {
      subject: emailId,
      date: new Date(receivedAt),
      from: [{ address: "sender@example.com" }],
      to: [{ address: "me@example.com" }],
    },
    internalDate: new Date(receivedAt),
  };
}
