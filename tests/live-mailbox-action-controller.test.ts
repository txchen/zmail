import { describe, expect, it, vi } from "vite-plus/test";
import {
  applyConfirmedAccountCounts,
  confirmationRemovesSourceView,
  createMailboxActionController,
} from "../apps/web/src/mailbox-action-controller";
import {
  createEphemeralMailState,
  liveMessageDetailKey,
  liveMessageListKey,
} from "../apps/web/src/live-mail-memory";
import type { MailboxActionConfirmation } from "../packages/shared/src";

describe("Browser Mailbox action controller", () => {
  it("does not update Ephemeral mail state until Gmail confirms success", async () => {
    const pending = Promise.withResolvers<MailboxActionConfirmation>();
    const perform = vi.fn(() => pending.promise);
    const queryClient = createEphemeralMailState();
    const detailKey = liveMessageDetailKey("personal", "message-1");
    queryClient.setQueryData(detailKey, { message: messageDetail(true) });
    const controller = createMailboxActionController({
      queryClient,
      perform,
      mailboxesForAccount: () => [],
    });

    const action = controller.perform({
      accountId: "personal",
      messageId: "message-1",
      action: "markRead",
    });
    expect(queryClient.getQueryData(detailKey)).toMatchObject({ message: { unread: true } });

    pending.resolve(
      confirmation(
        "markRead",
        state(true, false, "inbox", "allMail"),
        state(false, false, "inbox", "allMail"),
      ),
    );
    await action;

    expect(perform).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(detailKey)).toMatchObject({ message: { unread: false } });
  });

  it("preserves prior state and performs no retry after an uncertain result", async () => {
    const perform = vi.fn(async () => {
      throw new Error("Gmail outcome uncertain");
    });
    const queryClient = createEphemeralMailState();
    const detailKey = liveMessageDetailKey("personal", "message-1");
    queryClient.setQueryData(detailKey, { message: messageDetail(true) });
    const controller = createMailboxActionController({
      queryClient,
      perform,
      mailboxesForAccount: () => [],
    });

    await expect(
      controller.perform({
        accountId: "personal",
        messageId: "message-1",
        action: "markRead",
      }),
    ).rejects.toThrow("Gmail outcome uncertain");

    expect(perform).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(detailKey)).toMatchObject({ message: { unread: true } });
  });

  it("uses confirmed system roles for Account unread membership and counts despite navigation", async () => {
    const pending = Promise.withResolvers<MailboxActionConfirmation>();
    const queryClient = createEphemeralMailState();
    const unreadView = { kind: "unread" as const, accountId: "personal" };
    const inboxView = {
      kind: "mailbox" as const,
      accountId: "personal",
      mailboxId: "INBOX",
    };
    const trashView = {
      kind: "mailbox" as const,
      accountId: "personal",
      mailboxId: "[Gmail]/Trash",
    };
    queryClient.setQueryData(liveMessageDetailKey("personal", "message-1"), {
      message: messageDetail(true),
    });
    queryClient.setQueryData(liveMessageListKey(unreadView), {
      messages: [messageDetail(true)],
    });
    queryClient.setQueryData(liveMessageListKey(inboxView), {
      messages: [messageDetail(true)],
    });
    queryClient.setQueryData(liveMessageListKey(trashView), { messages: [] });
    const mailboxes = [
      mailbox("INBOX", "inbox", 1, 1),
      mailbox("[Gmail]/Spam", "spam", 2, 2),
      mailbox("[Gmail]/Trash", "trash", 0, 0),
    ];
    const controller = createMailboxActionController({
      queryClient,
      perform: () => pending.promise,
      mailboxesForAccount: () => mailboxes,
    });
    const action = controller.perform({
      accountId: "personal",
      messageId: "message-1",
      action: "delete",
    });

    // The route may change while Gmail is deciding; confirmation state remains authoritative.
    const currentRoute = {
      kind: "mailbox" as const,
      accountId: "personal",
      mailboxId: "[Gmail]/Spam",
    };
    const confirmed = confirmation(
      "delete",
      state(true, false, "inbox", "allMail"),
      state(true, false, "trash"),
    );
    pending.resolve(confirmed);
    await action;

    expect(currentRoute.mailboxId).toBe("[Gmail]/Spam");
    expect(queryClient.getQueryData(liveMessageListKey(unreadView))).toEqual({ messages: [] });
    expect(queryClient.getQueryData(liveMessageListKey(inboxView))).toEqual({ messages: [] });
    expect(queryClient.getQueryData(liveMessageListKey(trashView))).toMatchObject({
      messages: [{ id: "message-1" }],
    });
    const account = applyConfirmedAccountCounts(
      {
        id: "personal",
        emailAddress: "me@example.com",
        syncStatus: "synced",
        unreadCount: 1,
        mailboxes,
      },
      confirmed,
    );
    expect(account).toMatchObject({
      unreadCount: 0,
      mailboxes: [
        { id: "INBOX", totalCount: 0, unreadCount: 0 },
        { id: "[Gmail]/Spam", totalCount: 2, unreadCount: 2 },
        { id: "[Gmail]/Trash", totalCount: 1, unreadCount: 1 },
      ],
    });
  });

  it("keeps Spam and Trash unread state out of Account unread", async () => {
    const queryClient = createEphemeralMailState();
    const unreadView = { kind: "unread" as const, accountId: "personal" };
    queryClient.setQueryData(liveMessageListKey(unreadView), { messages: [] });
    queryClient.setQueryData(liveMessageDetailKey("personal", "message-1"), {
      message: messageDetail(false),
    });
    const confirmed = confirmation(
      "markUnread",
      state(false, false, "spam"),
      state(true, false, "spam"),
    );
    const controller = createMailboxActionController({
      queryClient,
      perform: async () => confirmed,
      mailboxesForAccount: () => [mailbox("[Gmail]/Spam", "spam", 1, 0)],
    });

    await controller.perform({
      accountId: "personal",
      messageId: "message-1",
      action: "markUnread",
    });

    expect(queryClient.getQueryData(liveMessageListKey(unreadView))).toEqual({ messages: [] });
    expect(
      applyConfirmedAccountCounts(
        {
          id: "personal",
          emailAddress: "me@example.com",
          syncStatus: "synced",
          unreadCount: 0,
          mailboxes: [mailbox("[Gmail]/Spam", "spam", 1, 0)],
        },
        confirmed,
      ),
    ).toMatchObject({
      unreadCount: 0,
      mailboxes: [{ id: "[Gmail]/Spam", unreadCount: 1 }],
    });
  });

  it("removes Archive from the source only when that source is Inbox", () => {
    const confirmed = confirmation(
      "archive",
      state(true, false, "inbox", "allMail"),
      state(true, false, "allMail"),
    );
    expect(
      confirmationRemovesSourceView(confirmed, {
        kind: "mailbox",
        accountId: "personal",
        mailboxId: "INBOX",
      }),
    ).toBe(true);
    expect(
      confirmationRemovesSourceView(confirmed, {
        kind: "mailbox",
        accountId: "personal",
        mailboxId: "[Gmail]/All Mail",
      }),
    ).toBe(false);
    expect(
      confirmationRemovesSourceView(confirmed, {
        kind: "mailbox",
        accountId: "personal",
        mailboxId: "Projects",
      }),
    ).toBe(false);
    expect(
      confirmationRemovesSourceView(confirmed, {
        kind: "search",
        accountId: "personal",
        query: "invoice",
      }),
    ).toBe(false);
  });

  it("removes a deleted Message from its confirmed custom Mailbox membership and counts", async () => {
    const queryClient = createEphemeralMailState();
    const projectsView = {
      kind: "mailbox" as const,
      accountId: "personal",
      mailboxId: "Projects",
    };
    queryClient.setQueryData(liveMessageListKey(projectsView), {
      messages: [messageDetail(true)],
    });
    queryClient.setQueryData(liveMessageDetailKey("personal", "message-1"), {
      message: messageDetail(true),
    });
    const before = {
      ...state(true, false, "allMail"),
      mailboxIds: ["Projects", "[Gmail]/All Mail"],
    };
    const after = state(true, false, "trash");
    const confirmed = confirmation("delete", before, after);
    const mailboxes = [
      mailbox("Projects", undefined, 1, 1),
      mailbox("[Gmail]/Trash", "trash", 0, 0),
    ];
    const controller = createMailboxActionController({
      queryClient,
      perform: async () => confirmed,
      mailboxesForAccount: () => mailboxes,
    });

    await controller.perform({
      accountId: "personal",
      messageId: "message-1",
      action: "delete",
    });

    expect(queryClient.getQueryData(liveMessageListKey(projectsView))).toEqual({ messages: [] });
    expect(
      applyConfirmedAccountCounts(
        {
          id: "personal",
          emailAddress: "me@example.com",
          syncStatus: "synced",
          unreadCount: 1,
          mailboxes,
        },
        confirmed,
      ),
    ).toMatchObject({
      mailboxes: [
        { id: "Projects", totalCount: 0, unreadCount: 0 },
        { id: "[Gmail]/Trash", totalCount: 1, unreadCount: 1 },
      ],
    });
  });

  it("updates a confirmed custom Mailbox unread count for mark read", () => {
    const before = {
      ...state(true, false, "allMail"),
      mailboxIds: ["Projects", "[Gmail]/All Mail"],
    };
    const after = {
      ...state(false, false, "allMail"),
      mailboxIds: ["Projects", "[Gmail]/All Mail"],
    };

    expect(
      applyConfirmedAccountCounts(
        {
          id: "personal",
          emailAddress: "me@example.com",
          syncStatus: "synced",
          unreadCount: 1,
          mailboxes: [mailbox("Projects", undefined, 1, 1)],
        },
        confirmation("markRead", before, after),
      ),
    ).toMatchObject({
      unreadCount: 0,
      mailboxes: [{ id: "Projects", totalCount: 1, unreadCount: 0 }],
    });
  });
});

function confirmation(
  action: MailboxActionConfirmation["action"],
  before: MailboxActionConfirmation["before"],
  after: MailboxActionConfirmation["after"],
): MailboxActionConfirmation {
  return { accountId: "personal", messageId: "message-1", action, before, after };
}

function state(
  unread: boolean,
  starred: boolean,
  ...systemMailboxRoles: MailboxActionConfirmation["after"]["systemMailboxRoles"]
) {
  const mailboxIds = systemMailboxRoles.map((role) => {
    if (role === "inbox") return "INBOX";
    if (role === "spam") return "[Gmail]/Spam";
    if (role === "trash") return "[Gmail]/Trash";
    if (role === "allMail") return "[Gmail]/All Mail";
    return "[Gmail]/Starred";
  });
  return { unread, starred, mailboxIds, systemMailboxRoles };
}

function mailbox(
  id: string,
  systemRole: "inbox" | "spam" | "trash" | "allMail" | undefined,
  totalCount: number,
  unreadCount: number,
) {
  return {
    id,
    name: id,
    path: id,
    ...(systemRole ? { systemRole } : {}),
    totalCount,
    unreadCount,
    selectable: true,
  };
}

function messageDetail(unread: boolean) {
  return {
    accountId: "personal",
    id: "message-1",
    subject: "Message",
    sender: { address: "sender@example.com" },
    recipients: [{ address: "me@example.com" }],
    ccRecipients: [],
    bccRecipients: [],
    receivedAt: "2026-07-17T12:00:00.000Z",
    unread,
    starred: false,
    readableBody: "<p>Body</p>",
    inlineResources: [],
    attachments: [],
  };
}
