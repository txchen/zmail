import type { MailboxAction } from "@zmail/shared";

export type MailboxActionTarget = {
  accountId: string;
  messageId: string;
};

export type MailboxActionClient = {
  markRead(target: MailboxActionTarget): Promise<void>;
  markUnread(target: MailboxActionTarget): Promise<void>;
  archive(target: MailboxActionTarget): Promise<void>;
  delete(target: MailboxActionTarget): Promise<void>;
  star(target: MailboxActionTarget): Promise<void>;
  unstar(target: MailboxActionTarget): Promise<void>;
};

export type { MailboxAction };
