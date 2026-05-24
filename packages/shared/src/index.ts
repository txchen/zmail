export type HealthStatus = {
  service: "zmail-api";
  status: "ok";
};

export const healthy: HealthStatus = {
  service: "zmail-api",
  status: "ok",
};

export type MailAccountSummary = {
  id: string;
  displayName: string;
  emailAddress: string;
};

export type MailAccountsResponse = {
  mailAccounts: MailAccountSummary[];
};

export type MailboxSummary = {
  id: string;
  name: string;
  unreadCount: number;
};

export type MailAccountMailboxTree = MailAccountSummary & {
  syncStatus: "synced" | "syncing" | "stale" | "failing";
  unreadCount: number;
  mailboxes: MailboxSummary[];
};

export type MailboxTreeResponse = {
  mailAccounts: MailAccountMailboxTree[];
};
