import type {
  LiveMessagePage,
  LiveMessageResponse,
  LiveMessageSummary,
  LiveMailAccount,
  MailboxAction,
  MailboxActionConfirmation,
  MailboxActionMessageState,
} from "@zmail/shared";
import type { QueryClient } from "@tanstack/vue-query";
import { liveMessageDetailKey, type LiveBrowserMessageListView } from "./live-mail-memory";
import type { ReaderRoute } from "./reader-routes";

export function createMailboxActionController(options: {
  queryClient: QueryClient;
  perform(
    accountId: string,
    messageId: string,
    action: MailboxAction,
  ): Promise<MailboxActionConfirmation>;
  mailboxesForAccount(accountId: string): Array<{ id: string; systemRole?: string }>;
}) {
  return {
    async perform(request: {
      accountId: string;
      messageId: string;
      action: MailboxAction;
    }): Promise<MailboxActionConfirmation> {
      const confirmation = await options.perform(
        request.accountId,
        request.messageId,
        request.action,
      );
      applyConfirmedMailboxAction(
        options.queryClient,
        confirmation,
        options.mailboxesForAccount(confirmation.accountId),
      );
      return confirmation;
    },
  };
}

export function applyConfirmedAccountCounts(
  account: LiveMailAccount,
  confirmation: MailboxActionConfirmation,
): LiveMailAccount {
  const beforeAccountUnread = isAccountUnreadMember(confirmation.before);
  const afterAccountUnread = isAccountUnreadMember(confirmation.after);
  return {
    ...account,
    unreadCount: Math.max(
      0,
      account.unreadCount + Number(afterAccountUnread) - Number(beforeAccountUnread),
    ),
    mailboxes: account.mailboxes.map((mailbox) => {
      const beforeMember = confirmation.before.mailboxIds.includes(mailbox.id);
      const afterMember = confirmation.after.mailboxIds.includes(mailbox.id);
      const beforeUnread = beforeMember && confirmation.before.unread;
      const afterUnread = afterMember && confirmation.after.unread;
      return {
        ...mailbox,
        totalCount: Math.max(0, mailbox.totalCount + Number(afterMember) - Number(beforeMember)),
        unreadCount: Math.max(0, mailbox.unreadCount + Number(afterUnread) - Number(beforeUnread)),
      };
    }),
  };
}

export function confirmationRemovesSourceView(
  confirmation: MailboxActionConfirmation,
  sourceView: ReaderRoute,
): boolean {
  if (sourceView.kind === "search" || sourceView.kind === "none") {
    return false;
  }
  if (sourceView.kind === "unread") {
    return isAccountUnreadMember(confirmation.before) && !isAccountUnreadMember(confirmation.after);
  }
  return (
    confirmation.before.mailboxIds.includes(sourceView.mailboxId) &&
    !confirmation.after.mailboxIds.includes(sourceView.mailboxId)
  );
}

function applyConfirmedMailboxAction(
  queryClient: QueryClient,
  confirmation: MailboxActionConfirmation,
  mailboxes: Array<{ id: string; systemRole?: string }>,
): void {
  const { accountId, messageId, after } = confirmation;
  const detailKey = liveMessageDetailKey(accountId, messageId);
  const detail = queryClient.getQueryData<LiveMessageResponse>(detailKey);
  let cachedMessage: LiveMessageSummary | undefined = detail?.message;

  for (const query of queryClient.getQueryCache().findAll({ queryKey: ["message-list"] })) {
    const page = query.state.data as LiveMessagePage | undefined;
    cachedMessage ??= page?.messages.find(
      (message) => message.accountId === accountId && message.id === messageId,
    );
  }

  queryClient.setQueryData<LiveMessageResponse>(detailKey, (current) =>
    current ? { message: applyConfirmedState(current.message, after) } : current,
  );

  for (const query of queryClient.getQueryCache().findAll({ queryKey: ["message-list"] })) {
    const page = query.state.data as LiveMessagePage | undefined;
    const view = query.queryKey[1];
    if (!page || !isAccountView(view, accountId)) {
      continue;
    }

    const memberAfter = isMemberAfterConfirmation(view, after, mailboxes);
    let messages = page.messages
      .filter(
        (message) =>
          memberAfter !== false || message.accountId !== accountId || message.id !== messageId,
      )
      .map((message) =>
        message.accountId === accountId && message.id === messageId
          ? applyConfirmedState(message, after)
          : message,
      );

    if (
      memberAfter === true &&
      cachedMessage &&
      !messages.some((message) => message.accountId === accountId && message.id === messageId)
    ) {
      messages = [applyConfirmedState(cachedMessage, after), ...messages];
    }
    queryClient.setQueryData(query.queryKey, { ...page, messages });
  }
}

function isMemberAfterConfirmation(
  view: LiveBrowserMessageListView,
  state: MailboxActionMessageState,
  mailboxes: Array<{ id: string; systemRole?: string }>,
): boolean | undefined {
  if (view.kind === "unread") {
    return isAccountUnreadMember(state);
  }
  if (view.kind !== "mailbox") {
    return undefined;
  }
  return mailboxes.some((mailbox) => mailbox.id === view.mailboxId)
    ? state.mailboxIds.includes(view.mailboxId)
    : undefined;
}

function applyConfirmedState<T extends LiveMessageSummary>(
  message: T,
  state: MailboxActionMessageState,
): T {
  return { ...message, unread: state.unread, starred: state.starred };
}

function isAccountView(value: unknown, accountId: string): value is LiveBrowserMessageListView {
  return (
    typeof value === "object" &&
    value !== null &&
    "accountId" in value &&
    value.accountId === accountId &&
    "kind" in value
  );
}

function isAccountUnreadMember(state: MailboxActionMessageState): boolean {
  return (
    state.unread &&
    !state.systemMailboxRoles.includes("spam") &&
    !state.systemMailboxRoles.includes("trash")
  );
}
