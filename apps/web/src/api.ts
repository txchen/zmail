import type {
  AccountOpenResponse,
  AccountRefreshRequest,
  AccountRefreshResponse,
  AccountSyncStatusResponse,
  HealthStatus,
  LiveMessagePage,
  LiveMessageResponse,
  MailboxActionConfirmation,
  MailAccountDiagnosticsResponse,
  MailboxAction,
  MailboxTreeResponse,
  MailAccountsResponse,
  ScheduleSyncJobRequest,
  SessionResponse,
  SyncJobResponse,
  SyncJobsResponse,
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

export async function openMailAccount(
  mailAccountId: string,
  fetcher: typeof fetch = fetch,
): Promise<AccountOpenResponse> {
  const response = await fetcher(`/api/mail-accounts/${encodeURIComponent(mailAccountId)}/open`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Mail account unavailable");
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

export function refreshMailAccount(
  mailAccountId: string,
  request: AccountRefreshRequest,
  fetcher?: typeof fetch,
): Promise<AccountRefreshResponse>;
/** @deprecated Retained for the persisted-mail path until ticket 07 removes legacy surfaces. */
export function refreshMailAccount(
  mailAccountId: string,
  fetcher?: typeof fetch,
): Promise<MailboxTreeResponse>;
export async function refreshMailAccount(
  mailAccountId: string,
  requestOrFetcher: AccountRefreshRequest | typeof fetch = fetch,
  fetcher: typeof fetch = fetch,
): Promise<AccountRefreshResponse | MailboxTreeResponse> {
  const request = typeof requestOrFetcher === "function" ? undefined : requestOrFetcher;
  const resolvedFetcher = typeof requestOrFetcher === "function" ? requestOrFetcher : fetcher;
  const response = await resolvedFetcher(
    `/api/mail-accounts/${encodeURIComponent(mailAccountId)}/refresh`,
    {
      method: "POST",
      ...(request
        ? {
            body: JSON.stringify(request),
            headers: { "content-type": "application/json" },
          }
        : {}),
    },
  );

  if (!response.ok) {
    throw new Error("Refresh failed");
  }

  return response.json();
}

export async function fetchMessagesForMailbox(
  mailAccountId: string,
  mailboxId: string,
  optionsOrFetcher: { limit?: number; cursor?: string } | typeof fetch = {},
  fetcher: typeof fetch = fetch,
): Promise<LiveMessagePage> {
  const options = typeof optionsOrFetcher === "function" ? {} : optionsOrFetcher;
  const resolvedFetcher = typeof optionsOrFetcher === "function" ? optionsOrFetcher : fetcher;
  const search = new URLSearchParams();
  if (options.limit !== undefined) {
    search.set("limit", String(options.limit));
  }
  if (options.cursor) {
    search.set("cursor", options.cursor);
  }
  const query = search.toString();
  const response = await resolvedFetcher(
    `/api/mail-accounts/${encodeURIComponent(mailAccountId)}/mailboxes/${encodeURIComponent(
      mailboxId,
    )}/messages${query ? `?${query}` : ""}`,
  );

  if (!response.ok) {
    throw new Error("Messages unavailable");
  }

  return response.json();
}

export async function fetchUnreadMessagesForAccount(
  mailAccountId: string,
  optionsOrFetcher: { limit?: number; cursor?: string } | typeof fetch = {},
  fetcher: typeof fetch = fetch,
): Promise<LiveMessagePage> {
  const options = typeof optionsOrFetcher === "function" ? {} : optionsOrFetcher;
  const resolvedFetcher = typeof optionsOrFetcher === "function" ? optionsOrFetcher : fetcher;
  const search = new URLSearchParams();
  if (options.limit !== undefined) {
    search.set("limit", String(options.limit));
  }
  if (options.cursor) {
    search.set("cursor", options.cursor);
  }
  const query = search.toString();
  const response = await resolvedFetcher(
    `/api/mail-accounts/${mailAccountId}/messages/unread${query ? `?${query}` : ""}`,
  );

  if (!response.ok) {
    throw new Error("Unread messages unavailable");
  }

  return response.json();
}

export async function searchMessagesForAccount(
  mailAccountId: string,
  query: string,
  optionsOrFetcher: { limit?: number; cursor?: string } | typeof fetch = {},
  fetcher: typeof fetch = fetch,
): Promise<LiveMessagePage> {
  const options = typeof optionsOrFetcher === "function" ? {} : optionsOrFetcher;
  const resolvedFetcher = typeof optionsOrFetcher === "function" ? optionsOrFetcher : fetcher;
  const search = new URLSearchParams();
  if (options.limit !== undefined) {
    search.set("limit", String(options.limit));
  }
  if (options.cursor) {
    search.set("cursor", options.cursor);
  }
  const paginationQuery = search.toString();
  const response = await resolvedFetcher(
    `/api/mail-accounts/${encodeURIComponent(mailAccountId)}/messages/search?q=${encodeURIComponent(query)}${
      paginationQuery ? `&${paginationQuery}` : ""
    }`,
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

export async function scheduleSyncJob(
  request: ScheduleSyncJobRequest,
  fetcher: typeof fetch = fetch,
): Promise<SyncJobResponse> {
  const response = await fetcher("/api/sync-jobs", {
    method: "POST",
    body: JSON.stringify(request),
    headers: { "content-type": "application/json" },
  });

  if (!response.ok) {
    throw new Error("Sync job scheduling failed");
  }

  return response.json();
}

export async function fetchSyncJobs(fetcher: typeof fetch = fetch): Promise<SyncJobsResponse> {
  const response = await fetcher("/api/sync-jobs");

  if (!response.ok) {
    throw new Error("Sync jobs unavailable");
  }

  return response.json();
}

export async function fetchMessage(
  mailAccountId: string,
  messageId: string,
  fetcher: typeof fetch = fetch,
): Promise<LiveMessageResponse> {
  const response = await fetcher(
    `/api/mail-accounts/${encodeURIComponent(mailAccountId)}/messages/${encodeURIComponent(
      messageId,
    )}`,
  );

  if (!response.ok) {
    throw new Error("Message unavailable");
  }

  return response.json();
}

export function attachmentDownloadUrl(
  mailAccountId: string,
  messageId: string,
  attachmentId: string,
): string {
  return `/api/mail-accounts/${encodeURIComponent(mailAccountId)}/messages/${encodeURIComponent(
    messageId,
  )}/attachments/${encodeURIComponent(attachmentId)}`;
}

export async function performMailboxAction(
  mailAccountId: string,
  messageId: string,
  action: MailboxAction,
  fetcher: typeof fetch = fetch,
): Promise<MailboxActionConfirmation> {
  const response = await fetcher(
    `/api/mail-accounts/${encodeURIComponent(mailAccountId)}/messages/${encodeURIComponent(
      messageId,
    )}/actions`,
    {
      method: "POST",
      body: JSON.stringify({ action }),
      headers: { "content-type": "application/json" },
    },
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(
      body?.error ??
        "Gmail did not confirm the Mailbox action. Refresh to verify or safely repeat the same target-state action.",
    );
  }

  return response.json();
}
