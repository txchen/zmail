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

export type AttachmentMetadata = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export type MailboxMessageSummary = {
  id: string;
  stableIdentity: string;
  subject: string;
  receivedAt: string;
  unread: boolean;
  starred: boolean;
  mailboxEntryId: string;
  attachments: AttachmentMetadata[];
};

export type MessageDetail = {
  id: string;
  stableIdentity: string;
  subject: string;
  receivedAt: string;
  unread: boolean;
  starred: boolean;
  readableBody: string;
  plainTextBody?: string;
  attachments: AttachmentMetadata[];
};

export type MailboxMessagesResponse = {
  messages: MailboxMessageSummary[];
};

export type MessageResponse = {
  message: MessageDetail;
};

export type MailboxAction = "markRead" | "markUnread" | "archive" | "delete" | "star" | "unstar";
