import { describe, expect, it } from "vite-plus/test";
import {
  fetchMessagesForMailbox,
  fetchUnreadMessagesForAccount,
  refreshMailAccount,
  searchMessagesForAccount,
} from "../apps/web/src/api";

describe("web message list API pagination", () => {
  it("passes limit and cursor query parameters to message list endpoints", async () => {
    const paths: string[] = [];
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
      paths.push(String(input));

      return Response.json({ messages: [], nextCursor: "next" });
    };

    await fetchMessagesForMailbox("personal", "INBOX", { limit: 100, cursor: "cursor-1" }, fetcher);
    await fetchUnreadMessagesForAccount("personal", { limit: 100, cursor: "cursor-2" }, fetcher);
    await searchMessagesForAccount(
      "personal",
      "hello world",
      { limit: 100, cursor: "cursor-3" },
      fetcher,
    );

    expect(paths).toEqual([
      "/api/mail-accounts/personal/mailboxes/INBOX/messages?limit=100&cursor=cursor-1",
      "/api/mail-accounts/personal/messages/unread?limit=100&cursor=cursor-2",
      "/api/mail-accounts/personal/messages/search?q=hello%20world&limit=100&cursor=cursor-3",
    ]);
  });

  it("sends Manual refresh as one account-scoped request with the current view", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const fetcher = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      requests.push({ path: String(input), init });

      return Response.json({
        mailAccount: {
          id: "personal/account",
          emailAddress: "me@example.com",
          unreadCount: 0,
          mailboxes: [],
        },
        view: { kind: "unread", messages: [] },
      });
    };

    await refreshMailAccount(
      "personal/account",
      {
        view: { kind: "unread" },
        selectedMessageId: "gmail-message-1",
      },
      fetcher,
    );

    expect(requests).toEqual([
      {
        path: "/api/mail-accounts/personal%2Faccount/refresh",
        init: {
          method: "POST",
          body: JSON.stringify({
            view: { kind: "unread" },
            selectedMessageId: "gmail-message-1",
          }),
          headers: { "content-type": "application/json" },
        },
      },
    ]);
  });
});
