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
  path: string;
  parentId?: string;
  systemRole?: SystemMailboxRole;
  unreadCount: number;
  totalCount: number;
  selectable: boolean;
};

export type SystemMailboxRole =
  | "inbox"
  | "sent"
  | "drafts"
  | "spam"
  | "trash"
  | "allMail"
  | "archive"
  | "flagged";

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

export type MessageParticipant = {
  address: string;
  displayName?: string;
};

export type MailboxMessageSummary = {
  accountId: string;
  id: string;
  stableIdentity: string;
  threadId?: string;
  subject: string;
  sender: MessageParticipant;
  recipients: MessageParticipant[];
  ccRecipients: MessageParticipant[];
  bccRecipients: MessageParticipant[];
  receivedAt: string;
  unread: boolean;
  starred: boolean;
  mailboxIds: string[];
  snippet: string;
  attachmentCount: number;
  updatedAt: string;
};

export type MessageDetail = MailboxMessageSummary & {
  readableBody: string;
  plainTextBody?: string;
  blockedRemoteImageCount: number;
  attachments: AttachmentMetadata[];
};

export type MailboxMessagesResponse = {
  messages: MailboxMessageSummary[];
  nextCursor?: string;
};

export type MessageResponse = {
  message: MessageDetail;
};

export type MailboxAction = "markRead" | "markUnread" | "archive" | "delete" | "star" | "unstar";

export type SessionResponse =
  | {
      authenticated: false;
    }
  | {
      authenticated: true;
      username: string;
      expiresAt: string;
    };

export type AccountSyncStatusResponse = {
  accountId: string;
  syncStatus: MailAccountMailboxTree["syncStatus"];
  lastSyncStartedAt?: string;
  lastSyncFinishedAt?: string;
  lastError?: string;
};

export type MailAccountDiagnosticsResponse =
  | {
      success: true;
      visibleMailboxCount: number;
    }
  | {
      success: false;
      lastError: string;
    };
