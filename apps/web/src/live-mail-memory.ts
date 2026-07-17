import type {
  AccountRefreshResponse,
  LiveMessageListView,
  LiveMessagePage,
  MessageResponse,
} from "@zmail/shared";
import { QueryClient } from "@tanstack/vue-query";

export type LiveBrowserMessageListView = LiveMessageListView & {
  accountId: string;
};

export function createEphemeralMailState(): QueryClient {
  return new QueryClient();
}

export function liveMessageListKey(view: LiveBrowserMessageListView) {
  return ["message-list", view] as const;
}

export const ephemeralMailQueryPolicy = {
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: Number.POSITIVE_INFINITY,
  refetchInterval: false as const,
  refetchOnMount: false as const,
  refetchOnReconnect: false as const,
  refetchOnWindowFocus: false as const,
};

export function liveMessageListQueryOptions(
  view: LiveBrowserMessageListView,
  readPage: () => Promise<LiveMessagePage>,
) {
  return {
    queryKey: liveMessageListKey(view),
    queryFn: readPage,
    ...ephemeralMailQueryPolicy,
  };
}

export function appendLiveMessagePage(
  queryClient: QueryClient,
  view: LiveBrowserMessageListView,
  nextPage: LiveMessagePage,
): void {
  queryClient.setQueryData<LiveMessagePage>(liveMessageListKey(view), (currentPage) => ({
    messages: [...(currentPage?.messages ?? []), ...nextPage.messages],
    ...(nextPage.nextCursor ? { nextCursor: nextPage.nextCursor } : {}),
  }));
}

export function cacheManualRefresh(
  queryClient: QueryClient,
  accountId: string,
  response: AccountRefreshResponse,
): void {
  queryClient.removeQueries({
    predicate: (query) => {
      if (query.queryKey[0] !== "message-list") {
        return false;
      }

      const view = query.queryKey[1];
      return (
        typeof view === "object" &&
        view !== null &&
        "accountId" in view &&
        view.accountId === accountId &&
        "kind" in view &&
        (view.kind === "mailbox" || view.kind === "unread")
      );
    },
  });
  const { messages, nextCursor, ...listView } = response.view;
  const view = { accountId, ...listView };

  queryClient.setQueryData(liveMessageListKey(view), {
    messages,
    ...(nextCursor ? { nextCursor } : {}),
  });

  if (response.selectedMessageId && !response.selectedMessage) {
    queryClient.removeQueries({
      queryKey: ["message-detail", accountId, response.selectedMessageId],
      exact: true,
    });
  }

  if (response.selectedMessage) {
    queryClient.setQueryData<MessageResponse>(
      ["message-detail", accountId, response.selectedMessage.id],
      (current) =>
        current
          ? {
              message: {
                ...current.message,
                ...response.selectedMessage,
              },
            }
          : current,
    );
  }
}
