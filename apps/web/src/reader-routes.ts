export type ReaderRoute =
  | { kind: "unread"; accountId: string; messageId?: string }
  | { kind: "mailbox"; accountId: string; mailboxId: string; messageId?: string }
  | { kind: "search"; accountId: string; query: string; messageId?: string }
  | { kind: "none" };

export type MessageListRoute =
  | { kind: "unread"; accountId: string }
  | { kind: "mailbox"; accountId: string; mailboxId: string }
  | { kind: "search"; accountId: string; query: string }
  | { kind: "none" };

export function parseReaderRoute(path: string, query: Record<string, unknown>): ReaderRoute {
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);

  if (parts[0] !== "accounts" || !parts[1]) {
    return { kind: "none" };
  }

  const accountId = parts[1];

  if (parts[2] === "unread") {
    return { kind: "unread", accountId, messageId: parts[4] === "messages" ? parts[5] : undefined };
  }

  if (parts[2] === "mailboxes" && parts[3]) {
    return {
      kind: "mailbox",
      accountId,
      mailboxId: parts[3],
      messageId: parts[5] === undefined ? undefined : parts[5],
    };
  }

  if (parts[2] === "search") {
    const q = typeof query.q === "string" ? query.q : "";
    return {
      kind: "search",
      accountId,
      query: q,
      messageId: parts[4] === "messages" ? parts[5] : undefined,
    };
  }

  return { kind: "none" };
}

export function messageListViewForRoute(current: ReaderRoute): MessageListRoute {
  if (current.kind === "mailbox") {
    return {
      kind: current.kind,
      accountId: current.accountId,
      mailboxId: current.mailboxId,
    };
  }
  if (current.kind === "unread") {
    return {
      kind: current.kind,
      accountId: current.accountId,
    };
  }
  if (current.kind === "search") {
    return {
      kind: current.kind,
      accountId: current.accountId,
      query: current.query,
    };
  }
  return current;
}

export function unreadPath(accountId: string): string {
  return `/accounts/${encodeURIComponent(accountId)}/unread`;
}

export function defaultReaderPath(
  mailAccounts: Array<{ id: string; mailboxes?: Array<{ id: string }> }>,
): string | undefined {
  const account = mailAccounts[0];
  const mailbox = account?.mailboxes?.[0];

  return account && mailbox ? mailboxPath(account.id, mailbox.id) : undefined;
}

export function mailboxPath(accountId: string, mailboxId: string): string {
  return `/accounts/${encodeURIComponent(accountId)}/mailboxes/${encodeURIComponent(mailboxId)}`;
}

export function searchPath(accountId: string, query: string): string {
  return `/accounts/${encodeURIComponent(accountId)}/search?q=${encodeURIComponent(query)}`;
}

export function messagePath(current: ReaderRoute, messageId: string, fallbackPath: string): string {
  if (current.kind === "unread") {
    return `${unreadPath(current.accountId)}/messages/${encodeURIComponent(messageId)}`;
  }

  if (current.kind === "mailbox") {
    return `${mailboxPath(current.accountId, current.mailboxId)}/messages/${encodeURIComponent(messageId)}`;
  }

  if (current.kind === "search") {
    return `/accounts/${encodeURIComponent(current.accountId)}/search/messages/${encodeURIComponent(
      messageId,
    )}?q=${encodeURIComponent(current.query)}`;
  }

  return fallbackPath;
}

export function listPath(current: ReaderRoute, fallbackPath: string): string {
  if (current.kind === "unread") {
    return unreadPath(current.accountId);
  }

  if (current.kind === "mailbox") {
    return mailboxPath(current.accountId, current.mailboxId);
  }

  if (current.kind === "search") {
    return searchPath(current.accountId, current.query);
  }

  return fallbackPath;
}

export function nextMessagePathAfterRemoval(
  current: ReaderRoute,
  removedMessageId: string,
  messages: { id: string }[],
  fallbackPath: string,
): string {
  const index = messages.findIndex((message) => message.id === removedMessageId);
  const adjacent = messages[index + 1] ?? messages[index - 1];

  return adjacent
    ? messagePath(current, adjacent.id, fallbackPath)
    : listPath(current, fallbackPath);
}
