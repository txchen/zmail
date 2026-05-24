import { DatabaseSync } from "node:sqlite";

export type AccountSyncStatus = "synced" | "syncing" | "stale" | "failing";

export type StoredMailAccount = {
  id: string;
  emailAddress: string;
  syncStatus: AccountSyncStatus;
  lastSyncStartedAt?: string;
  lastSyncFinishedAt?: string;
  lastError?: string;
};

export type StoredMailbox = {
  id: string;
  name: string;
  path?: string;
  parentId?: string;
  systemRole?: SystemMailboxRole;
  unreadCount: number;
  totalCount?: number;
  selectable?: boolean;
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

export type StoredMessage = {
  id: string;
  stableIdentity: string;
  threadId?: string;
  subject: string;
  sender?: MessageParticipant;
  recipients?: MessageParticipant[];
  receivedAt: string;
  unread: boolean;
  starred: boolean;
  aiProcessed: boolean;
  snippet?: string;
  readableBody: string;
  plainTextBody?: string;
  blockedRemoteImageCount?: number;
  updatedAt?: string;
  attachments: AttachmentMetadata[];
};

export type MessageParticipant = {
  address: string;
  displayName?: string;
};

export type AttachmentMetadata = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export type StoredMailboxEntry = {
  id: string;
  mailboxId: string;
  messageId: string;
};

type MessageWithMailboxEntries = StoredMessage & {
  mailboxEntries: Array<{
    id: string;
    mailboxId: string;
    mailboxName: string;
  }>;
};

export type MessageSummary = {
  accountId: string;
  id: string;
  stableIdentity: string;
  threadId?: string;
  subject: string;
  sender: MessageParticipant;
  recipients: MessageParticipant[];
  receivedAt: string;
  unread: boolean;
  starred: boolean;
  mailboxIds: string[];
  snippet: string;
  attachmentCount: number;
  updatedAt: string;
};

export type MailboxMessageSummary = MessageSummary;

export type MessageListOptions = {
  limit?: number;
  cursor?: {
    receivedAt: string;
    id: string;
  };
  filters?: MessageFilters;
};

export type MessageFilters = {
  unread?: boolean;
  starred?: boolean;
  hasAttachments?: boolean;
  from?: string;
  after?: string;
  before?: string;
};

export type MessageListPage = {
  messages: MailboxMessageSummary[];
  nextCursor?: string;
};

export type MessageDetail = MessageSummary & {
  readableBody: string;
  plainTextBody?: string;
  blockedRemoteImageCount: number;
  attachments: AttachmentMetadata[];
};

export type AiMessageSummary = MessageSummary;

export type AiMessageDetail = MessageDetail;

export function createHybridPersistence(): HybridPersistence {
  return new HybridPersistence(new DatabaseSync(":memory:"));
}

export class HybridPersistence {
  readonly app: AppDatabase;

  private readonly mailDatabases = new Map<string, MailDatabase>();

  constructor(appDatabase: DatabaseSync) {
    this.app = new AppDatabase(appDatabase);
  }

  mailDatabaseFor(mailAccountId: string): MailDatabase {
    const existing = this.mailDatabases.get(mailAccountId);

    if (existing) {
      return existing;
    }

    const database = new MailDatabase(new DatabaseSync(":memory:"));
    this.mailDatabases.set(mailAccountId, database);

    return database;
  }
}

export class AppDatabase {
  constructor(private readonly database: DatabaseSync) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS mail_accounts (
        id TEXT PRIMARY KEY,
        email_address TEXT NOT NULL,
        sync_status TEXT NOT NULL,
        last_sync_started_at TEXT,
        last_sync_finished_at TEXT,
        last_error TEXT
      )
    `);
  }

  saveMailAccount(account: StoredMailAccount): void {
    this.database
      .prepare(`
        INSERT INTO mail_accounts (
          id,
          email_address,
          sync_status,
          last_sync_started_at,
          last_sync_finished_at,
          last_error
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          email_address = excluded.email_address,
          sync_status = excluded.sync_status,
          last_sync_started_at = excluded.last_sync_started_at,
          last_sync_finished_at = excluded.last_sync_finished_at,
          last_error = excluded.last_error
      `)
      .run(
        account.id,
        account.emailAddress,
        account.syncStatus,
        account.lastSyncStartedAt ?? null,
        account.lastSyncFinishedAt ?? null,
        account.lastError ?? null,
      );
  }

  listMailAccounts(): StoredMailAccount[] {
    return this.database
      .prepare(`
        SELECT id, email_address, sync_status, last_sync_started_at, last_sync_finished_at, last_error
        FROM mail_accounts
        ORDER BY id
      `)
      .all()
      .map((row) => {
        const account = row as {
          id: string;
          email_address: string;
          sync_status: AccountSyncStatus;
          last_sync_started_at: string | null;
          last_sync_finished_at: string | null;
          last_error: string | null;
        };

        return {
          id: account.id,
          emailAddress: account.email_address,
          syncStatus: account.sync_status,
          ...(account.last_sync_started_at ? { lastSyncStartedAt: account.last_sync_started_at } : {}),
          ...(account.last_sync_finished_at
            ? { lastSyncFinishedAt: account.last_sync_finished_at }
            : {}),
          ...(account.last_error ? { lastError: account.last_error } : {}),
        };
      });
  }
}

export class MailDatabase {
  constructor(private readonly database: DatabaseSync) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS mailboxes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        parent_id TEXT,
        system_role TEXT,
        unread_count INTEGER NOT NULL,
        total_count INTEGER NOT NULL,
        selectable INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        stable_identity TEXT NOT NULL UNIQUE,
        thread_id TEXT,
        subject TEXT NOT NULL,
        sender_json TEXT NOT NULL DEFAULT '{"address":""}',
        recipients_json TEXT NOT NULL DEFAULT '[]',
        received_at TEXT NOT NULL DEFAULT '',
        unread INTEGER NOT NULL,
        starred INTEGER NOT NULL DEFAULT 0,
        ai_processed INTEGER NOT NULL,
        snippet TEXT NOT NULL DEFAULT '',
        readable_body TEXT NOT NULL DEFAULT '',
        plain_text_body TEXT,
        blocked_remote_image_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT '',
        attachments_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS mailbox_entries (
        id TEXT PRIMARY KEY,
        mailbox_id TEXT NOT NULL REFERENCES mailboxes(id),
        message_id TEXT NOT NULL REFERENCES messages(id),
        UNIQUE(mailbox_id, message_id)
      );
    `);
  }

  setMessageUnread(messageId: string, unread: boolean): void {
    this.database
      .prepare(`
        UPDATE messages
        SET unread = ?
        WHERE id = ?
      `)
      .run(unread ? 1 : 0, messageId);
  }

  setMessageStarred(messageId: string, starred: boolean): void {
    this.database
      .prepare(`
        UPDATE messages
        SET starred = ?
        WHERE id = ?
      `)
      .run(starred ? 1 : 0, messageId);
  }

  saveMailbox(mailbox: StoredMailbox): void {
    this.database
      .prepare(`
        INSERT INTO mailboxes (id, name, path, parent_id, system_role, unread_count, total_count, selectable)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          path = excluded.path,
          parent_id = excluded.parent_id,
          system_role = excluded.system_role,
          unread_count = excluded.unread_count,
          total_count = excluded.total_count,
          selectable = excluded.selectable
      `)
      .run(
        mailbox.id,
        mailbox.name,
        mailbox.path ?? mailbox.name,
        mailbox.parentId ?? null,
        mailbox.systemRole ?? null,
        mailbox.unreadCount,
        mailbox.totalCount ?? mailbox.unreadCount,
        mailbox.selectable === false ? 0 : 1,
      );
  }

  listMailboxes(): StoredMailbox[] {
    return this.database
      .prepare(`
        SELECT id, name, path, parent_id, system_role, unread_count, total_count, selectable
        FROM mailboxes
        ORDER BY id
      `)
      .all()
      .map((row) => {
        const mailbox = row as {
          id: string;
          name: string;
          path: string;
          parent_id: string | null;
          system_role: SystemMailboxRole | null;
          unread_count: number;
          total_count: number;
          selectable: number;
        };

        return {
          id: mailbox.id,
          name: mailbox.name,
          path: mailbox.path,
          ...(mailbox.parent_id ? { parentId: mailbox.parent_id } : {}),
          ...(mailbox.system_role ? { systemRole: mailbox.system_role } : {}),
          unreadCount: mailbox.unread_count,
          totalCount: mailbox.total_count,
          selectable: mailbox.selectable === 1,
        };
      });
  }

  saveMessage(message: StoredMessage): void {
    this.database
      .prepare(`
        INSERT INTO messages (
          id, stable_identity, thread_id, subject, sender_json, recipients_json, received_at,
          unread, starred, ai_processed, snippet, readable_body, plain_text_body,
          blocked_remote_image_count, updated_at, attachments_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          stable_identity = excluded.stable_identity,
          thread_id = excluded.thread_id,
          subject = excluded.subject,
          sender_json = excluded.sender_json,
          recipients_json = excluded.recipients_json,
          received_at = excluded.received_at,
          unread = excluded.unread,
          starred = excluded.starred,
          ai_processed = excluded.ai_processed,
          snippet = excluded.snippet,
          readable_body = excluded.readable_body,
          plain_text_body = excluded.plain_text_body,
          blocked_remote_image_count = excluded.blocked_remote_image_count,
          updated_at = excluded.updated_at,
          attachments_json = excluded.attachments_json
      `)
      .run(
        message.id,
        message.stableIdentity,
        message.threadId ?? null,
        message.subject,
        JSON.stringify(message.sender ?? { address: "" }),
        JSON.stringify(message.recipients ?? []),
        message.receivedAt,
        message.unread ? 1 : 0,
        message.starred ? 1 : 0,
        message.aiProcessed ? 1 : 0,
        message.snippet ?? "",
        message.readableBody,
        message.plainTextBody ?? null,
        message.blockedRemoteImageCount ?? 0,
        message.updatedAt ?? message.receivedAt,
        JSON.stringify(message.attachments),
      );
  }

  saveMailboxEntry(entry: StoredMailboxEntry): void {
    this.database
      .prepare(`
        INSERT INTO mailbox_entries (id, mailbox_id, message_id)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          mailbox_id = excluded.mailbox_id,
          message_id = excluded.message_id
      `)
      .run(entry.id, entry.mailboxId, entry.messageId);
  }

  removeMailboxEntry(messageId: string, mailboxId: string): void {
    this.database
      .prepare(`
        DELETE FROM mailbox_entries
        WHERE message_id = ? AND mailbox_id = ?
      `)
      .run(messageId, mailboxId);
  }

  listMessagesWithMailboxEntries(): MessageWithMailboxEntries[] {
    const messages = this.database
      .prepare(`
        SELECT id, stable_identity, subject, received_at, unread, starred, ai_processed, readable_body, attachments_json
        FROM messages
        ORDER BY id
      `)
      .all() as Array<{
      id: string;
      stable_identity: string;
      subject: string;
      received_at: string;
      unread: number;
      starred: number;
      ai_processed: number;
      readable_body: string;
      attachments_json: string;
    }>;

    const entries = this.database
      .prepare(`
        SELECT mailbox_entries.id, mailbox_entries.message_id, mailboxes.id AS mailbox_id, mailboxes.name AS mailbox_name
        FROM mailbox_entries
        JOIN mailboxes ON mailboxes.id = mailbox_entries.mailbox_id
        ORDER BY mailbox_entries.id DESC
      `)
      .all() as Array<{
      id: string;
      message_id: string;
      mailbox_id: string;
      mailbox_name: string;
    }>;

    return messages.map((message) => ({
      id: message.id,
      stableIdentity: message.stable_identity,
      subject: message.subject,
      receivedAt: message.received_at,
      unread: Boolean(message.unread),
      starred: Boolean(message.starred),
      aiProcessed: Boolean(message.ai_processed),
      readableBody: message.readable_body,
      attachments: JSON.parse(message.attachments_json) as AttachmentMetadata[],
      mailboxEntries: entries
        .filter((entry) => entry.message_id === message.id)
        .map((entry) => ({
          id: entry.id,
          mailboxId: entry.mailbox_id,
          mailboxName: entry.mailbox_name,
        })),
    }));
  }

  listMessagesForMailbox(
    accountId: string,
    mailboxId?: string,
    options: MessageListOptions = {},
  ): MessageListPage {
    const resolvedAccountId = mailboxId === undefined ? "" : accountId;
    const resolvedMailboxId = mailboxId ?? accountId;
    const limit = Math.min(options.limit ?? 50, 200);

    const messages = this.database
      .prepare(`
        SELECT messages.id, messages.stable_identity, messages.thread_id, messages.subject,
          messages.sender_json, messages.recipients_json, messages.received_at,
          messages.unread, messages.starred, messages.snippet, messages.updated_at,
          messages.attachments_json
        FROM mailbox_entries
        JOIN messages ON messages.id = mailbox_entries.message_id
        WHERE mailbox_entries.mailbox_id = ?
        ORDER BY messages.received_at DESC, messages.id DESC
      `)
      .all(resolvedMailboxId)
      .map((row) => {
        const message = row as {
          id: string;
          stable_identity: string;
          thread_id: string | null;
          subject: string;
          sender_json: string;
          recipients_json: string;
          received_at: string;
          unread: number;
          starred: number;
          snippet: string;
          updated_at: string;
          attachments_json: string;
        };
        const attachments = JSON.parse(message.attachments_json) as AttachmentMetadata[];

        return {
          accountId: resolvedAccountId,
          id: message.id,
          stableIdentity: message.stable_identity,
          ...(message.thread_id ? { threadId: message.thread_id } : {}),
          subject: message.subject,
          sender: JSON.parse(message.sender_json) as MessageParticipant,
          recipients: JSON.parse(message.recipients_json) as MessageParticipant[],
          receivedAt: message.received_at,
          unread: Boolean(message.unread),
          starred: Boolean(message.starred),
          mailboxIds: this.listMailboxIdsForMessage(message.id),
          snippet: message.snippet,
          attachmentCount: attachments.length,
          updatedAt: message.updated_at || message.received_at,
        };
      })
      .filter((message) => matchesMessageFilters(message, options.filters))
      .filter(
        (message) =>
          !options.cursor ||
          message.receivedAt < options.cursor.receivedAt ||
          (message.receivedAt === options.cursor.receivedAt && message.id < options.cursor.id),
      );

    const pageMessages = messages.slice(0, limit);
    const hasNextPage = messages.length > limit;
    const lastMessage = pageMessages.at(-1);

    return {
      messages: pageMessages,
      ...(hasNextPage && lastMessage
        ? { nextCursor: encodeMessageCursor(lastMessage.receivedAt, lastMessage.id) }
        : {}),
    };
  }

  getMessage(accountId: string, messageId?: string): MessageDetail | null {
    const resolvedAccountId = messageId === undefined ? "" : accountId;
    const resolvedMessageId = messageId ?? accountId;
    const row = this.database
      .prepare(`
        SELECT id, stable_identity, thread_id, subject, sender_json, recipients_json, received_at,
          unread, starred, snippet, readable_body, plain_text_body, blocked_remote_image_count,
          updated_at, attachments_json
        FROM messages
        WHERE id = ?
      `)
      .get(resolvedMessageId) as
      | {
          id: string;
          stable_identity: string;
          thread_id: string | null;
          subject: string;
          sender_json: string;
          recipients_json: string;
          received_at: string;
          unread: number;
          starred: number;
          snippet: string;
          readable_body: string;
          plain_text_body: string | null;
          blocked_remote_image_count: number;
          updated_at: string;
          attachments_json: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    const attachments = JSON.parse(row.attachments_json) as AttachmentMetadata[];

    return {
      accountId: resolvedAccountId,
      id: row.id,
      stableIdentity: row.stable_identity,
      ...(row.thread_id ? { threadId: row.thread_id } : {}),
      subject: row.subject,
      sender: JSON.parse(row.sender_json) as MessageParticipant,
      recipients: JSON.parse(row.recipients_json) as MessageParticipant[],
      receivedAt: row.received_at,
      unread: Boolean(row.unread),
      starred: Boolean(row.starred),
      mailboxIds: this.listMailboxIdsForMessage(row.id),
      snippet: row.snippet,
      attachmentCount: attachments.length,
      updatedAt: row.updated_at || row.received_at,
      readableBody: row.readable_body,
      ...(row.plain_text_body ? { plainTextBody: row.plain_text_body } : {}),
      blockedRemoteImageCount: row.blocked_remote_image_count,
      attachments,
    };
  }

  listUnreadMessages(mailAccountId: string): AiMessageSummary[] {
    return this.database
      .prepare(`
        SELECT id, stable_identity, thread_id, subject, sender_json, recipients_json, received_at,
          unread, starred, snippet, updated_at, attachments_json
        FROM messages
        WHERE unread = 1
        ORDER BY received_at DESC, id
      `)
      .all()
      .map((row) => {
        const message = row as {
          id: string;
          stable_identity: string;
          thread_id: string | null;
          subject: string;
          sender_json: string;
          recipients_json: string;
          received_at: string;
          unread: number;
          starred: number;
          snippet: string;
          updated_at: string;
          attachments_json: string;
        };
        const attachments = JSON.parse(message.attachments_json) as AttachmentMetadata[];

        return {
          accountId: mailAccountId,
          id: message.id,
          stableIdentity: message.stable_identity,
          ...(message.thread_id ? { threadId: message.thread_id } : {}),
          subject: message.subject,
          sender: JSON.parse(message.sender_json) as MessageParticipant,
          recipients: JSON.parse(message.recipients_json) as MessageParticipant[],
          receivedAt: message.received_at,
          unread: Boolean(message.unread),
          starred: Boolean(message.starred),
          mailboxIds: this.listMailboxIdsForMessage(message.id),
          snippet: message.snippet,
          attachmentCount: attachments.length,
          updatedAt: message.updated_at || message.received_at,
        };
      });
  }

  getMessageByStableIdentity(
    mailAccountId: string,
    stableIdentity: string,
  ): AiMessageDetail | null {
    const row = this.database
      .prepare(`
        SELECT id, stable_identity, thread_id, subject, sender_json, recipients_json, received_at,
          unread, starred, snippet, readable_body, plain_text_body, blocked_remote_image_count,
          updated_at, attachments_json
        FROM messages
        WHERE stable_identity = ?
      `)
      .get(stableIdentity) as
      | {
          id: string;
          stable_identity: string;
          thread_id: string | null;
          subject: string;
          sender_json: string;
          recipients_json: string;
          received_at: string;
          unread: number;
          starred: number;
          snippet: string;
          readable_body: string;
          plain_text_body: string | null;
          blocked_remote_image_count: number;
          updated_at: string;
          attachments_json: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    const attachments = JSON.parse(row.attachments_json) as AttachmentMetadata[];

    return {
      accountId: mailAccountId,
      id: row.id,
      stableIdentity: row.stable_identity,
      ...(row.thread_id ? { threadId: row.thread_id } : {}),
      subject: row.subject,
      sender: JSON.parse(row.sender_json) as MessageParticipant,
      recipients: JSON.parse(row.recipients_json) as MessageParticipant[],
      receivedAt: row.received_at,
      unread: Boolean(row.unread),
      starred: Boolean(row.starred),
      mailboxIds: this.listMailboxIdsForMessage(row.id),
      snippet: row.snippet,
      attachmentCount: attachments.length,
      updatedAt: row.updated_at || row.received_at,
      readableBody: row.readable_body,
      ...(row.plain_text_body ? { plainTextBody: row.plain_text_body } : {}),
      blockedRemoteImageCount: row.blocked_remote_image_count,
      attachments,
    };
  }

  private listMailboxIdsForMessage(messageId: string): string[] {
    return this.database
      .prepare(`
        SELECT mailbox_id
        FROM mailbox_entries
        WHERE message_id = ?
        ORDER BY mailbox_id
      `)
      .all(messageId)
      .map((row) => (row as { mailbox_id: string }).mailbox_id);
  }
}

function matchesMessageFilters(message: MessageSummary, filters: MessageFilters = {}): boolean {
  if (filters.unread !== undefined && message.unread !== filters.unread) {
    return false;
  }

  if (filters.starred !== undefined && message.starred !== filters.starred) {
    return false;
  }

  if (filters.hasAttachments !== undefined && (message.attachmentCount > 0) !== filters.hasAttachments) {
    return false;
  }

  if (filters.from && message.sender.address.toLowerCase() !== filters.from.toLowerCase()) {
    return false;
  }

  if (filters.after && message.receivedAt <= filters.after) {
    return false;
  }

  if (filters.before && message.receivedAt >= filters.before) {
    return false;
  }

  return true;
}

function encodeMessageCursor(receivedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ receivedAt, id }), "utf8").toString("base64url");
}
