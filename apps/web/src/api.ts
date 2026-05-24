import type { HealthStatus, MailboxTreeResponse, MailAccountsResponse } from "@zmail/shared";

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
