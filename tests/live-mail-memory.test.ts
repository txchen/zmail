import { describe, expect, it, vi } from "vite-plus/test";
import {
  appendLiveMessagePage,
  cacheManualRefresh,
  createEphemeralMailState,
  liveMessageDetailQueryOptions,
  liveMessageListKey,
  liveMessageListQueryOptions,
} from "../apps/web/src/live-mail-memory";

const inboxView = {
  kind: "mailbox" as const,
  accountId: "personal",
  mailboxId: "INBOX",
};

describe("Ephemeral mail state", () => {
  it("disables every automatic query trigger for the page session", () => {
    const queryClient = createEphemeralMailState();

    expect(queryClient.getDefaultOptions()).toMatchObject({
      queries: {
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
        refetchInterval: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
      },
      mutations: {
        retry: false,
      },
    });
  });

  it("returns to a visited Message list from browser memory without another request", async () => {
    const queryClient = createEphemeralMailState();
    const readInbox = vi.fn(async () => ({
      messages: [message("newest")],
      nextCursor: "next-page",
    }));

    await queryClient.fetchQuery(liveMessageListQueryOptions(inboxView, readInbox));
    await queryClient.fetchQuery(liveMessageListQueryOptions(inboxView, readInbox));

    expect(readInbox).toHaveBeenCalledOnce();
  });

  it("returns to an opened Message from browser memory without another Gmail request", async () => {
    const queryClient = createEphemeralMailState();
    const readMessage = vi.fn(async () => ({
      message: {
        ...message("opened"),
        ccRecipients: [],
        bccRecipients: [],
        readableBody: "<p>Cached body</p>",
        inlineResources: [],
        attachments: [],
      },
    }));

    await queryClient.fetchQuery(liveMessageDetailQueryOptions("personal", "opened", readMessage));
    await queryClient.fetchQuery(liveMessageDetailQueryOptions("personal", "opened", readMessage));

    expect(readMessage).toHaveBeenCalledOnce();
  });

  it("stops after a failed Message read until the App user explicitly retries", async () => {
    const queryClient = createEphemeralMailState();
    const readMessage = vi.fn(async () => {
      throw new Error("Gmail unavailable");
    });

    await expect(
      queryClient.fetchQuery(liveMessageDetailQueryOptions("personal", "missing", readMessage)),
    ).rejects.toThrow("Gmail unavailable");

    expect(readMessage).toHaveBeenCalledOnce();
  });

  it("appends only after explicit Load more and retains loaded pagination", () => {
    const queryClient = createEphemeralMailState();
    queryClient.setQueryData(liveMessageListKey(inboxView), {
      messages: [message("newest")],
      nextCursor: "next-page",
    });

    appendLiveMessagePage(queryClient, inboxView, {
      messages: [message("older")],
    });

    expect(queryClient.getQueryData(liveMessageListKey(inboxView))).toEqual({
      messages: [message("newest"), message("older")],
    });
  });

  it("Manual refresh clears only one account list memory and rebuilds its current view", () => {
    const queryClient = createEphemeralMailState();
    const workView = {
      kind: "mailbox" as const,
      accountId: "work",
      mailboxId: "INBOX",
    };
    queryClient.setQueryData(liveMessageListKey(inboxView), {
      messages: [message("stale")],
      nextCursor: "stale-page",
    });
    queryClient.setQueryData(liveMessageListKey({ kind: "unread", accountId: "personal" }), {
      messages: [message("also-stale")],
    });
    queryClient.setQueryData(liveMessageListKey(workView), {
      messages: [message("work-cached", "work")],
    });
    const searchKey = ["message-list", { kind: "search", accountId: "personal", query: "invoice" }];
    queryClient.setQueryData(searchKey, {
      messages: [message("search-cached")],
    });
    queryClient.setQueryData(["message-detail", "personal", "fresh"], {
      message: {
        ...message("fresh"),
        subject: "stale subject",
        stableIdentity: "gmail:personal:fresh",
        ccRecipients: [],
        bccRecipients: [],
        mailboxIds: ["INBOX"],
        snippet: "",
        attachmentCount: 0,
        updatedAt: "2026-07-17T12:00:00.000Z",
        readableBody: "<p>Already loaded body</p>",
        blockedRemoteImageCount: 0,
        inlineResources: [],
        attachments: [],
      },
    });

    cacheManualRefresh(queryClient, "personal", {
      mailAccount: {
        id: "personal",
        emailAddress: "me@example.com",
        unreadCount: 1,
        mailboxes: [],
      },
      view: {
        kind: "mailbox",
        mailboxId: "INBOX",
        messages: [message("fresh")],
      },
      selectedMessageId: "fresh",
      selectedMessage: { ...message("fresh"), subject: "fresh subject" },
    });

    expect(queryClient.getQueryData(liveMessageListKey(inboxView))).toEqual({
      messages: [message("fresh")],
    });
    expect(
      queryClient.getQueryData(liveMessageListKey({ kind: "unread", accountId: "personal" })),
    ).toBeUndefined();
    expect(queryClient.getQueryData(liveMessageListKey(workView))).toEqual({
      messages: [message("work-cached", "work")],
    });
    expect(queryClient.getQueryData(searchKey)).toEqual({
      messages: [message("search-cached")],
    });
    expect(queryClient.getQueryData(["message-detail", "personal", "fresh"])).toMatchObject({
      message: {
        id: "fresh",
        subject: "fresh subject",
        readableBody: "<p>Already loaded body</p>",
      },
    });
  });

  it("Manual refresh removes selected Message state that no longer exists", () => {
    const queryClient = createEphemeralMailState();
    queryClient.setQueryData(["message-detail", "personal", "gone"], {
      message: { id: "gone" },
    });

    cacheManualRefresh(queryClient, "personal", {
      mailAccount: {
        id: "personal",
        emailAddress: "me@example.com",
        unreadCount: 0,
        mailboxes: [],
      },
      view: {
        kind: "mailbox",
        mailboxId: "INBOX",
        messages: [],
      },
      selectedMessageId: "gone",
    });

    expect(queryClient.getQueryData(["message-detail", "personal", "gone"])).toBeUndefined();
  });
});

function message(id: string, accountId = "personal") {
  return {
    accountId,
    id,
    subject: id,
    sender: { address: "sender@example.com" },
    recipients: [{ address: "me@example.com" }],
    receivedAt: "2026-07-17T12:00:00.000Z",
    unread: true,
    starred: false,
  };
}
