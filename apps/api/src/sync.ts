import type { ConfiguredMailAccount } from "./config.js";
import { logError, logInfo } from "./logger.js";
import type {
  AccountSyncStatus,
  AttachmentMetadata,
  HybridPersistence,
  StoredMailbox,
  SystemMailboxRole,
} from "./persistence.js";

export type ImapMailbox = Omit<StoredMailbox, "systemRole"> & {
  specialUse?: string;
};

export type MailboxSyncClient = {
  listVisibleMailboxes(account: ConfiguredMailAccount): Promise<ImapMailbox[]>;
};

export type ImapMessage = {
  id: string;
  stableIdentity: string;
  uid?: number;
  threadId?: string;
  subject: string;
  sender?: {
    address: string;
    displayName?: string;
  };
  recipients?: Array<{
    address: string;
    displayName?: string;
  }>;
  receivedAt: string;
  unread: boolean;
  snippet?: string;
  readableBody: string;
  plainTextBody?: string;
  blockedRemoteImageCount?: number;
  updatedAt?: string;
  attachments: Array<AttachmentMetadata & { bytes?: unknown }>;
  mailboxIds: string[];
};

export type MessageSyncClient = {
  listRecentMessages(request: {
    account: ConfiguredMailAccount;
    mailboxes: Array<{
      id: string;
      since?: Date;
      afterUid?: number;
    }>;
  }): Promise<ImapMessage[]>;
};

export type SyncMailboxTreesOptions = {
  accounts: ConfiguredMailAccount[];
  persistence: HybridPersistence;
  client: MailboxSyncClient;
};

export type MailAccountSyncState = {
  accountId: string;
  syncStatus: AccountSyncStatus;
  lastSyncStartedAt?: string;
  lastSyncFinishedAt?: string;
  lastError?: string;
};

export async function syncMailboxTrees({
  accounts,
  persistence,
  client,
}: SyncMailboxTreesOptions): Promise<MailAccountSyncState[]> {
  const results: MailAccountSyncState[] = [];

  for (const account of accounts) {
    const lastSyncStartedAt = new Date().toISOString();
    const startedAt = Date.now();
    logInfo("mailbox.sync.start", { accountId: account.id });

    try {
      const mailboxes = await client.listVisibleMailboxes(account);
      const mailDatabase = persistence.mailDatabaseFor(account.id);
      const lastSyncFinishedAt = new Date().toISOString();

      for (const mailbox of mailboxes) {
        mailDatabase.saveMailbox({
          ...mailbox,
          systemRole: normalizeSystemMailboxRole(mailbox.specialUse),
        });
      }

      results.push({
        accountId: account.id,
        syncStatus: "synced",
        lastSyncStartedAt,
        lastSyncFinishedAt,
      });
      logInfo("mailbox.sync.finish", {
        accountId: account.id,
        durationMs: Date.now() - startedAt,
        mailboxCount: mailboxes.length,
      });
    } catch (error) {
      results.push({
        accountId: account.id,
        syncStatus: "failing",
        lastSyncStartedAt,
        lastSyncFinishedAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : String(error),
      });
      logError("mailbox.sync.error", {
        accountId: account.id,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

function normalizeSystemMailboxRole(specialUse: string | undefined): SystemMailboxRole | undefined {
  switch (specialUse?.toLowerCase()) {
    case "\\inbox":
      return "inbox";
    case "\\sent":
      return "sent";
    case "\\drafts":
      return "drafts";
    case "\\junk":
      return "spam";
    case "\\trash":
      return "trash";
    case "\\all":
      return "allMail";
    case "\\archive":
      return "archive";
    case "\\flagged":
      return "flagged";
    default:
      return undefined;
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
    const startedAt = Date.now();
    const mailDatabase = persistence.mailDatabaseFor(account.id);
    const mailboxes = mailDatabase
      .listMailboxes()
      .filter((mailbox) => mailbox.selectable !== false)
      .map((mailbox) => {
        const syncState = mailDatabase.getMailboxSyncState(mailbox.id);

        return {
          id: mailbox.id,
          ...(syncState ? { afterUid: syncState.highestUid } : { since }),
        };
      });
    const incrementalMailboxCount = mailboxes.filter((mailbox) => "afterUid" in mailbox).length;
    const backfillMailboxCount = mailboxes.length - incrementalMailboxCount;
    logInfo("message.sync.start", {
      accountId: account.id,
      mailboxCount: mailboxes.length,
      backfillMailboxCount,
      incrementalMailboxCount,
    });

    const messages = await client.listRecentMessages({ account, mailboxes });
    let storedMessageCount = 0;
    let storedMailboxEntryCount = 0;
    let skippedMessageCount = 0;

    for (const message of messages) {
      if (
        message.mailboxIds.some(
          (mailboxId) => !mailboxes.some((mailbox) => mailbox.id === mailboxId),
        )
      ) {
        skippedMessageCount += 1;
        continue;
      }

      if (
        message.mailboxIds.some((mailboxId) => {
          const mailbox = mailboxes.find((candidate) => candidate.id === mailboxId);

          return mailbox && "since" in mailbox && new Date(message.receivedAt) < mailbox.since;
        })
      ) {
        skippedMessageCount += 1;
        continue;
      }

      mailDatabase.saveMessage({
        id: message.id,
        stableIdentity: message.stableIdentity,
        threadId: message.threadId,
        subject: message.subject,
        sender: message.sender,
        recipients: message.recipients,
        receivedAt: message.receivedAt,
        unread: message.unread,
        starred: false,
        aiProcessed: false,
        snippet: message.snippet,
        readableBody: message.readableBody,
        plainTextBody: message.plainTextBody,
        blockedRemoteImageCount: message.blockedRemoteImageCount,
        updatedAt: message.updatedAt,
        attachments: message.attachments.map(({ id, filename, mimeType, sizeBytes }) => ({
          id,
          filename,
          mimeType,
          sizeBytes,
        })),
      });
      storedMessageCount += 1;

      for (const mailboxId of message.mailboxIds) {
        mailDatabase.saveMailboxEntry({
          id: `${message.id}:${mailboxId}`,
          mailboxId,
          messageId: message.id,
        });
        storedMailboxEntryCount += 1;

        if (message.uid !== undefined) {
          mailDatabase.saveMailboxSyncState({
            mailboxId,
            highestUid: message.uid,
            lastSyncedAt: now.toISOString(),
          });
        }
      }
    }
    logInfo("message.sync.finish", {
      accountId: account.id,
      durationMs: Date.now() - startedAt,
      fetchedMessageCount: messages.length,
      storedMessageCount,
      storedMailboxEntryCount,
      skippedMessageCount,
    });
  }
}
