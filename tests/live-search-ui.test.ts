import { describe, expect, it, vi } from "vite-plus/test";
import {
  appendLiveMessagePage,
  createEphemeralMailState,
  liveMessageListKey,
  liveMessageListQueryOptions,
} from "../apps/web/src/live-mail-memory";
import {
  messageListViewForRoute,
  parseReaderRoute,
  searchPath,
} from "../apps/web/src/reader-routes";

const searchView = {
  kind: "search" as const,
  accountId: "personal",
  query: " from:billing@example.com ",
};

describe("Live Search page-session behavior", () => {
  it("editing does not navigate, while Enter or the Search button submits exactly once", async () => {
    const queryClient = createEphemeralMailState();
    const readSearch = vi.fn(async () => ({ messages: [message("result")] }));
    let draft = "from:billing";

    draft = " from:billing@example.com ";
    expect(readSearch).not.toHaveBeenCalled();

    const submittedUrl = new URL(searchPath("personal", draft), "https://zmail.test");
    const route = parseReaderRoute(submittedUrl.pathname, {
      q: submittedUrl.searchParams.get("q"),
    });
    const view = messageListViewForRoute(route);
    await queryClient.fetchQuery(liveMessageListQueryOptions(view, readSearch));

    expect(readSearch).toHaveBeenCalledOnce();
    expect(view).toEqual(expect.objectContaining({ query: " from:billing@example.com " }));
  });

  it("returns to prior Search results from page-session memory and appends only on Load more", async () => {
    const queryClient = createEphemeralMailState();
    const readSearch = vi.fn(async () => ({
      messages: [message("newest")],
      nextCursor: "next-search-page",
    }));

    await queryClient.fetchQuery(liveMessageListQueryOptions(searchView, readSearch));
    await queryClient.fetchQuery(liveMessageListQueryOptions(searchView, readSearch));
    expect(readSearch).toHaveBeenCalledOnce();

    appendLiveMessagePage(queryClient, searchView, {
      messages: [message("older")],
    });

    expect(queryClient.getQueryData(liveMessageListKey(searchView))).toEqual({
      messages: [message("newest"), message("older")],
    });
  });

  it("opening a Search result reuses the list cache and fetches only Message detail", async () => {
    const queryClient = createEphemeralMailState();
    const readSearch = vi.fn(async () => ({ messages: [message("result")] }));
    const listRoute = parseReaderRoute("/accounts/personal/search", { q: "invoice" });
    const messageRoute = parseReaderRoute("/accounts/personal/search/messages/result", {
      q: "invoice",
    });

    await queryClient.fetchQuery(
      liveMessageListQueryOptions(messageListViewForRoute(listRoute), readSearch),
    );
    await queryClient.fetchQuery(
      liveMessageListQueryOptions(messageListViewForRoute(messageRoute), readSearch),
    );

    expect(readSearch).toHaveBeenCalledOnce();
  });
});

function message(id: string) {
  return {
    accountId: "personal",
    id,
    subject: id,
    sender: { address: "sender@example.com" },
    recipients: [{ address: "me@example.com" }],
    receivedAt: "2026-07-17T12:00:00.000Z",
    unread: true,
    starred: false,
  };
}
