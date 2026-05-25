import type { ConfiguredMailAccount } from "./config.js";
import { logError, logInfo } from "./logger.js";
import type {
  AccountSyncStatus,
  AttachmentMetadata,
  HybridPersistence,
  InlineMessageResource,
  StoredMailbox,
  SystemMailboxRole,
} from "./persistence.js";
import type { SyncJobResult } from "./sync-queue.js";

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
  ccRecipients?: Array<{
    address: string;
    displayName?: string;
  }>;
  bccRecipients?: Array<{
    address: string;
    displayName?: string;
  }>;
  receivedAt: string;
  unread: boolean;
  snippet?: string;
  bodyText?: string;
  readableBody: string;
  plainTextBody?: string;
  blockedRemoteImageCount?: number;
  updatedAt?: string;
  inlineResources?: InlineMessageResource[];
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

export type SyncRecentReconciliationOptions = {
  accounts: ConfiguredMailAccount[];
  persistence: HybridPersistence;
  client: MessageSyncClient;
  now?: Date;
  windowDays?: number;
};

export async function syncRecentMessages({
  accounts,
  persistence,
  client,
  now = new Date(),
  syncWindowDays = 90,
}: SyncRecentMessagesOptions): Promise<SyncJobResult> {
  const syncStartedAt = Date.now();
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - syncWindowDays);
  const result: SyncJobResult = {
    mailboxCount: 0,
    scannedMailboxCount: 0,
    skippedMailboxCount: 0,
    fetchedMessageCount: 0,
    storedMessageCount: 0,
    removedMailboxEntryCount: 0,
    durationMs: 0,
  };

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
    result.mailboxCount = (result.mailboxCount ?? 0) + mailboxes.length;
    result.scannedMailboxCount = (result.scannedMailboxCount ?? 0) + mailboxes.length;
    logInfo("message.sync.start", {
      accountId: account.id,
      mailboxCount: mailboxes.length,
      backfillMailboxCount,
      incrementalMailboxCount,
    });

    const messages = await client.listRecentMessages({ account, mailboxes });
    result.fetchedMessageCount = (result.fetchedMessageCount ?? 0) + messages.length;
    let storedMessageCount = 0;
    let storedMailboxEntryCount = 0;
    let skippedMessageCount = 0;
    const syncedMailboxIds = mailboxes.map((mailbox) => mailbox.id);

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
        ccRecipients: message.ccRecipients,
        bccRecipients: message.bccRecipients,
        receivedAt: message.receivedAt,
        unread: message.unread,
        starred: false,
        aiProcessed: false,
        snippet: message.snippet,
        bodyText: message.bodyText,
        readableBody: message.readableBody,
        plainTextBody: message.plainTextBody,
        blockedRemoteImageCount: message.blockedRemoteImageCount,
        updatedAt: message.updatedAt,
        inlineResources: message.inlineResources,
        attachments: message.attachments.map(({ id, filename, mimeType, sizeBytes }) => ({
          id,
          filename,
          mimeType,
          sizeBytes,
        })),
      });
      storedMessageCount += 1;
      result.storedMessageCount = (result.storedMessageCount ?? 0) + 1;
      mailDatabase.removeStaleMailboxEntries(message.id, syncedMailboxIds, message.mailboxIds);

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

  result.durationMs = Date.now() - syncStartedAt;
  return result;
}

export async function syncRecentReconciliation({
  accounts,
  persistence,
  client,
  now = new Date(),
  windowDays = 2,
}: SyncRecentReconciliationOptions): Promise<SyncJobResult> {
  const syncStartedAt = Date.now();
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - windowDays);
  const result: SyncJobResult = {
    mailboxCount: 0,
    scannedMailboxCount: 0,
    skippedMailboxCount: 0,
    fetchedMessageCount: 0,
    storedMessageCount: 0,
    removedMailboxEntryCount: 0,
    durationMs: 0,
  };

  for (const account of accounts) {
    const mailDatabase = persistence.mailDatabaseFor(account.id);
    const mailboxes = mailDatabase
      .listMailboxes()
      .filter((mailbox) => mailbox.selectable !== false)
      .map((mailbox) => ({ id: mailbox.id, since }));

    result.mailboxCount = (result.mailboxCount ?? 0) + mailboxes.length;
    result.scannedMailboxCount = (result.scannedMailboxCount ?? 0) + mailboxes.length;
    logInfo("message.reconciliation.start", {
      accountId: account.id,
      mailboxCount: mailboxes.length,
      windowDays,
    });

    const messages = await client.listRecentMessages({ account, mailboxes });
    const mailboxIds = mailboxes.map((mailbox) => mailbox.id);
    const reportedEntries: Array<{ messageId: string; mailboxId: string }> = [];
    result.fetchedMessageCount = (result.fetchedMessageCount ?? 0) + messages.length;

    for (const message of messages) {
      if (new Date(message.receivedAt) < since) {
        continue;
      }

      mailDatabase.saveMessage({
        id: message.id,
        stableIdentity: message.stableIdentity,
        threadId: message.threadId,
        subject: message.subject,
        sender: message.sender,
        recipients: message.recipients,
        ccRecipients: message.ccRecipients,
        bccRecipients: message.bccRecipients,
        receivedAt: message.receivedAt,
        unread: message.unread,
        starred: false,
        aiProcessed: false,
        snippet: message.snippet,
        bodyText: message.bodyText,
        readableBody: message.readableBody,
        plainTextBody: message.plainTextBody,
        blockedRemoteImageCount: message.blockedRemoteImageCount,
        updatedAt: message.updatedAt,
        inlineResources: message.inlineResources,
        attachments: message.attachments.map(({ id, filename, mimeType, sizeBytes }) => ({
          id,
          filename,
          mimeType,
          sizeBytes,
        })),
      });
      result.storedMessageCount = (result.storedMessageCount ?? 0) + 1;

      for (const mailboxId of message.mailboxIds.filter((mailboxId) =>
        mailboxIds.includes(mailboxId),
      )) {
        reportedEntries.push({ messageId: message.id, mailboxId });
        mailDatabase.saveMailboxEntry({
          id: `${message.id}:${mailboxId}`,
          mailboxId,
          messageId: message.id,
        });
      }
    }

    const removedMailboxEntryCount = mailDatabase.removeMailboxEntriesMissingSince(
      mailboxIds,
      since.toISOString(),
      reportedEntries,
    );
    result.removedMailboxEntryCount =
      (result.removedMailboxEntryCount ?? 0) + removedMailboxEntryCount;
    logInfo("message.reconciliation.finish", {
      accountId: account.id,
      fetchedMessageCount: messages.length,
      removedMailboxEntryCount,
    });
  }

  result.durationMs = Date.now() - syncStartedAt;
  return result;
}
