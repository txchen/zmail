import type {
  AccountSyncStatusResponse,
  HealthStatus,
  MailAccountDiagnosticsResponse,
  MailboxMessagesResponse,
  MailboxAction,
  MailboxTreeResponse,
  MailAccountsResponse,
  MessageResponse,
  SessionResponse,
} from "@zmail/shared";

export async function fetchHealth(fetcher: typeof fetch = fetch): Promise<HealthStatus> {
  const response = await fetcher("/api/health");

  return response.json();
}

export type LoginCredentials = {
  username: string;
  password: string;
};

export async function login(
  credentials: LoginCredentials,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher("/api/login", {
    method: "POST",
    body: JSON.stringify(credentials),
    headers: { "content-type": "application/json" },
  });

  if (!response.ok) {
    throw new Error("Login failed");
  }
}

export async function fetchSession(fetcher: typeof fetch = fetch): Promise<SessionResponse> {
  const response = await fetcher("/api/session");

  return response.json();
}

export async function logout(fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher("/api/logout", { method: "POST" });

  if (!response.ok) {
    throw new Error("Logout failed");
  }
}

export async function fetchMailAccounts(
  fetcher: typeof fetch = fetch,
): Promise<MailAccountsResponse> {
  const response = await fetcher("/api/mail-accounts");

  if (!response.ok) {
    throw new Error("Authentication required");
  }

  return response.json();
}

export async function fetchMailboxTree(
  fetcher: typeof fetch = fetch,
): Promise<MailboxTreeResponse> {
  const response = await fetcher("/api/mailbox-tree");

  if (!response.ok) {
    throw new Error("Authentication required");
  }

  return response.json();
}

export async function refreshMailAccount(
  mailAccountId: string,
  fetcher: typeof fetch = fetch,
): Promise<MailboxTreeResponse> {
  const response = await fetcher(`/api/mail-accounts/${mailAccountId}/refresh`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Refresh failed");
  }

  return response.json();
}

export async function fetchMessagesForMailbox(
  mailAccountId: string,
  mailboxId: string,
  fetcher: typeof fetch = fetch,
): Promise<MailboxMessagesResponse> {
  const response = await fetcher(
    `/api/mail-accounts/${mailAccountId}/mailboxes/${mailboxId}/messages`,
  );

  if (!response.ok) {
    throw new Error("Messages unavailable");
  }

  return response.json();
}

export async function fetchUnreadMessagesForAccount(
  mailAccountId: string,
  fetcher: typeof fetch = fetch,
): Promise<MailboxMessagesResponse> {
  const response = await fetcher(`/api/mail-accounts/${mailAccountId}/messages/unread`);

  if (!response.ok) {
    throw new Error("Unread messages unavailable");
  }

  return response.json();
}

export async function searchMessagesForAccount(
  mailAccountId: string,
  query: string,
  fetcher: typeof fetch = fetch,
): Promise<MailboxMessagesResponse> {
  const response = await fetcher(
    `/api/mail-accounts/${mailAccountId}/messages/search?q=${encodeURIComponent(query)}`,
  );

  if (!response.ok) {
    throw new Error("Search unavailable");
  }

  return response.json();
}

export async function fetchAccountSyncStatus(
  mailAccountId: string,
  fetcher: typeof fetch = fetch,
): Promise<AccountSyncStatusResponse> {
  const response = await fetcher(`/api/mail-accounts/${mailAccountId}/sync-status`);

  if (!response.ok) {
    throw new Error("Sync status unavailable");
  }

  return response.json();
}

export async function runMailAccountDiagnostics(
  mailAccountId: string,
  fetcher: typeof fetch = fetch,
): Promise<MailAccountDiagnosticsResponse> {
  const response = await fetcher(`/api/mail-accounts/${mailAccountId}/diagnose`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Diagnostics unavailable");
  }

  return response.json();
}

export async function fetchMessage(
  mailAccountId: string,
  messageId: string,
  fetcher: typeof fetch = fetch,
): Promise<MessageResponse> {
  const response = await fetcher(`/api/mail-accounts/${mailAccountId}/messages/${messageId}`);

  if (!response.ok) {
    throw new Error("Message unavailable");
  }

  return response.json();
}

export async function performMailboxAction(
  mailAccountId: string,
  messageId: string,
  action: MailboxAction,
  fetcher: typeof fetch = fetch,
): Promise<MessageResponse> {
  const response = await fetcher(
    `/api/mail-accounts/${mailAccountId}/messages/${messageId}/actions`,
    {
      method: "POST",
      body: JSON.stringify({ action }),
      headers: { "content-type": "application/json" },
    },
  );

  if (!response.ok) {
    throw new Error("Mailbox action failed");
  }

  return response.json();
}
