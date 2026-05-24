import type { ConfiguredMailAccount } from "./config.js";
import type { AttachmentMetadata, HybridPersistence, StoredMailbox } from "./persistence.js";

export type ImapMailbox = StoredMailbox;

export type MailboxSyncClient = {
  listVisibleMailboxes(account: ConfiguredMailAccount): Promise<ImapMailbox[]>;
};

export type ImapMessage = {
  id: string;
  stableIdentity: string;
  subject: string;
  receivedAt: string;
  unread: boolean;
  readableBody: string;
  attachments: Array<AttachmentMetadata & { bytes?: unknown }>;
  mailboxIds: string[];
};

export type MessageSyncClient = {
  listRecentMessages(request: {
    account: ConfiguredMailAccount;
    since: Date;
  }): Promise<ImapMessage[]>;
};

export type SyncMailboxTreesOptions = {
  accounts: ConfiguredMailAccount[];
  persistence: HybridPersistence;
  client: MailboxSyncClient;
};

export async function syncMailboxTrees({
  accounts,
  persistence,
  client,
}: SyncMailboxTreesOptions): Promise<void> {
  for (const account of accounts) {
    const lastSyncStartedAt = new Date().toISOString();

    try {
      const mailboxes = await client.listVisibleMailboxes(account);
      const mailDatabase = persistence.mailDatabaseFor(account.id);
      const lastSyncFinishedAt = new Date().toISOString();

      for (const mailbox of mailboxes) {
        mailDatabase.saveMailbox(mailbox);
      }

      persistence.app.saveMailAccount({
        id: account.id,
        emailAddress: account.emailAddress,
        syncStatus: "synced",
        lastSyncStartedAt,
        lastSyncFinishedAt,
      });
    } catch (error) {
      persistence.app.saveMailAccount({
        id: account.id,
        emailAddress: account.emailAddress,
        syncStatus: "failing",
        lastSyncStartedAt,
        lastSyncFinishedAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export type SyncRecentMessagesOptions = {
  accounts: ConfiguredMailAccount[];
  persistence: HybridPersistence;
  client: MessageSyncClient;
  now?: Date;
  syncWindowDays?: number;
};

export async function syncRecentMessages({
  accounts,
  persistence,
  client,
  now = new Date(),
  syncWindowDays = 90,
}: SyncRecentMessagesOptions): Promise<void> {
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - syncWindowDays);

  for (const account of accounts) {
    const messages = await client.listRecentMessages({ account, since });
    const mailDatabase = persistence.mailDatabaseFor(account.id);

    for (const message of messages) {
      if (new Date(message.receivedAt) < since) {
        continue;
      }

      mailDatabase.saveMessage({
        id: message.id,
        stableIdentity: message.stableIdentity,
        subject: message.subject,
        receivedAt: message.receivedAt,
        unread: message.unread,
        starred: false,
        aiProcessed: false,
        readableBody: message.readableBody,
        attachments: message.attachments.map(({ id, filename, mimeType, sizeBytes }) => ({
          id,
          filename,
          mimeType,
          sizeBytes,
        })),
      });

      for (const mailboxId of message.mailboxIds) {
        mailDatabase.saveMailboxEntry({
          id: `${message.id}:${mailboxId}`,
          mailboxId,
          messageId: message.id,
        });
      }
    }
  }
}
