export type ReaderRoute =
  | { kind: "unread"; accountId: string; messageId?: string }
  | { kind: "mailbox"; accountId: string; mailboxId: string; messageId?: string }
  | { kind: "search"; accountId: string; query: string; messageId?: string }
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
      query: q.trim(),
      messageId: parts[4] === "messages" ? parts[5] : undefined,
    };
  }

  return { kind: "none" };
}

export function unreadPath(accountId: string): string {
  return `/accounts/${encodeURIComponent(accountId)}/unread`;
}

export function defaultReaderPath(mailAccounts: { id: string }[]): string | undefined {
  return mailAccounts[0] ? unreadPath(mailAccounts[0].id) : undefined;
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
