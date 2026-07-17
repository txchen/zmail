export type MailAccountSummary = {
  id: string;
  emailAddress: string;
};

export type MailAccountsResponse = {
  mailAccounts: MailAccountSummary[];
  reader: {
    readDwellSeconds: number;
  };
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

export type LiveMailAccount = MailAccountSummary & {
  unreadCount: number;
  mailboxes: MailboxSummary[];
};

export type LiveMessageSummary = {
  accountId: string;
  id: string;
  threadId?: string;
  subject: string;
  sender: MessageParticipant;
  recipients: MessageParticipant[];
  receivedAt: string;
  unread: boolean;
  starred: boolean;
};

export type LiveMessageDetail = LiveMessageSummary & {
  ccRecipients: MessageParticipant[];
  bccRecipients: MessageParticipant[];
  readableBody: string;
  plainTextBody?: string;
  inlineResources: InlineMessageResourceMetadata[];
  attachments: AttachmentMetadata[];
};

export type LiveMessageResponse = {
  message: LiveMessageDetail;
};

export type AccountOpenResponse = {
  mailAccount: LiveMailAccount;
  inbox: {
    mailboxId: string;
    messages: LiveMessageSummary[];
    nextCursor?: string;
  };
};

export type LiveMessagePage = {
  messages: LiveMessageSummary[];
  nextCursor?: string;
};

export type LiveMessageListView =
  | {
      kind: "mailbox";
      mailboxId: string;
    }
  | {
      kind: "unread";
    };

export type AccountRefreshRequest = {
  view: LiveMessageListView;
  selectedMessageId?: string;
};

export type AccountRefreshResponse = {
  mailAccount: LiveMailAccount;
  view: LiveMessageListView & LiveMessagePage;
  selectedMessageId?: string;
  selectedMessage?: LiveMessageSummary;
};

export type AttachmentMetadata = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export type InlineMessageResourceMetadata = {
  id: string;
  contentId: string;
  mimeType: string;
  sizeBytes: number;
};

export type MessageParticipant = {
  address: string;
  displayName?: string;
};

export type MailboxAction = "markRead" | "markUnread" | "archive" | "delete" | "star" | "unstar";

export type MailboxActionMessageState = {
  unread: boolean;
  starred: boolean;
  mailboxIds: string[];
  systemMailboxRoles: Array<
    Extract<SystemMailboxRole, "inbox" | "spam" | "trash" | "allMail" | "flagged">
  >;
};

export type MailboxActionConfirmation = {
  accountId: string;
  messageId: string;
  action: MailboxAction;
  before: MailboxActionMessageState;
  after: MailboxActionMessageState;
};

export type SessionResponse =
  | {
      authenticated: false;
    }
  | {
      authenticated: true;
      username: string;
      expiresAt: string;
    };
