import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type AccountSyncStatus = "synced" | "syncing" | "stale" | "failing";

export type StoredMailbox = {
  id: string;
  name: string;
  path?: string;
  parentId?: string;
  systemRole?: SystemMailboxRole;
  unreadCount: number;
  totalCount?: number;
  selectable?: boolean;
  uidNext?: number;
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
  ccRecipients?: MessageParticipant[];
  bccRecipients?: MessageParticipant[];
  receivedAt: string;
  unread: boolean;
  starred: boolean;
  aiProcessed: boolean;
  snippet?: string;
  bodyText?: string;
  readableBody: string;
  plainTextBody?: string;
  blockedRemoteImageCount?: number;
  updatedAt?: string;
  inlineResources?: InlineMessageResource[];
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

export type InlineMessageResourceMetadata = {
  id: string;
  contentId: string;
  mimeType: string;
  sizeBytes: number;
};

export type InlineMessageResource = InlineMessageResourceMetadata & {
  bytes: Uint8Array;
};

export type StoredMailboxEntry = {
  id: string;
  mailboxId: string;
  messageId: string;
};

export type MailboxSyncState = {
  mailboxId: string;
  highestUid: number;
  messageCount?: number;
  uidNext?: number;
  lastSyncedAt: string;
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
  inlineResources: InlineMessageResourceMetadata[];
  attachments: AttachmentMetadata[];
};

export type AiMessageSummary = MessageSummary;

export type AiMessageDetail = MessageDetail;

export function createHybridPersistence(): HybridPersistence {
  return new HybridPersistence();
}

export function createFileBackedHybridPersistence(databaseDir: string): HybridPersistence {
  mkdirSync(databaseDir, { recursive: true });

  return new HybridPersistence({
    mailDatabasePath(mailAccountId) {
      return join(databaseDir, `${mailAccountId}.sqlite`);
    },
  });
}

type HybridPersistenceOptions = {
  mailDatabasePath?(mailAccountId: string): string;
};

export class HybridPersistence {
  private readonly mailDatabases = new Map<string, MailDatabase>();

  constructor(private readonly options: HybridPersistenceOptions = {}) {}

  mailDatabaseFor(mailAccountId: string): MailDatabase {
    const existing = this.mailDatabases.get(mailAccountId);

    if (existing) {
      return existing;
    }

    const database = new MailDatabase(
      new DatabaseSync(this.options.mailDatabasePath?.(mailAccountId) ?? ":memory:"),
    );
    this.mailDatabases.set(mailAccountId, database);

    return database;
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
        selectable INTEGER NOT NULL,
        uid_next INTEGER
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        stable_identity TEXT NOT NULL UNIQUE,
        thread_id TEXT,
        subject TEXT NOT NULL,
        sender_json TEXT NOT NULL DEFAULT '{"address":""}',
        recipients_json TEXT NOT NULL DEFAULT '[]',
        cc_recipients_json TEXT NOT NULL DEFAULT '[]',
        bcc_recipients_json TEXT NOT NULL DEFAULT '[]',
        received_at TEXT NOT NULL DEFAULT '',
        unread INTEGER NOT NULL,
        starred INTEGER NOT NULL DEFAULT 0,
        ai_processed INTEGER NOT NULL,
        snippet TEXT NOT NULL DEFAULT '',
        body_text TEXT NOT NULL DEFAULT '',
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

      CREATE TABLE IF NOT EXISTS mailbox_sync_states (
        mailbox_id TEXT PRIMARY KEY,
        highest_uid INTEGER NOT NULL,
        message_count INTEGER,
        uid_next INTEGER,
        last_synced_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inline_message_resources (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        content_id TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        bytes BLOB NOT NULL,
        UNIQUE(message_id, content_id)
      );
    `);
    this.ensureMessageTextColumn("body_text", "TEXT NOT NULL DEFAULT ''");
    this.ensureMessageJsonColumn("cc_recipients_json");
    this.ensureMessageJsonColumn("bcc_recipients_json");
    this.ensureMailboxSyncStateColumn("message_count", "INTEGER");
    this.ensureMailboxSyncStateColumn("uid_next", "INTEGER");
    this.ensureMailboxColumn("uid_next", "INTEGER");
  }

  private ensureMessageJsonColumn(columnName: string): void {
    this.ensureMessageTextColumn(columnName, "TEXT NOT NULL DEFAULT '[]'");
  }

  private ensureMessageTextColumn(columnName: string, definition: string): void {
    const columns = this.database.prepare("PRAGMA table_info(messages)").all() as Array<{
      name: string;
    }>;

    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    this.database.exec(`ALTER TABLE messages ADD COLUMN ${columnName} ${definition}`);
  }

  private ensureMailboxSyncStateColumn(columnName: string, definition: string): void {
    const columns = this.database.prepare("PRAGMA table_info(mailbox_sync_states)").all() as Array<{
      name: string;
    }>;

    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    this.database.exec(`ALTER TABLE mailbox_sync_states ADD COLUMN ${columnName} ${definition}`);
  }

  private ensureMailboxColumn(columnName: string, definition: string): void {
    const columns = this.database.prepare("PRAGMA table_info(mailboxes)").all() as Array<{
      name: string;
    }>;

    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    this.database.exec(`ALTER TABLE mailboxes ADD COLUMN ${columnName} ${definition}`);
  }

  setMessageUnread(messageId: string, unread: boolean): void {
    const existing = this.database
      .prepare(`
        SELECT unread
        FROM messages
        WHERE id = ?
      `)
      .get(messageId) as { unread: number } | undefined;

    if (!existing || Boolean(existing.unread) === unread) {
      return;
    }

    this.database
      .prepare(`
        UPDATE messages
        SET unread = ?
        WHERE id = ?
      `)
      .run(unread ? 1 : 0, messageId);
    this.database
      .prepare(`
        UPDATE mailboxes
        SET unread_count = max(0, unread_count + ?)
        WHERE id IN (
          SELECT mailbox_id
          FROM mailbox_entries
          WHERE message_id = ?
        )
      `)
      .run(unread ? 1 : -1, messageId);
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
        INSERT INTO mailboxes (id, name, path, parent_id, system_role, unread_count, total_count, selectable, uid_next)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          path = excluded.path,
          parent_id = excluded.parent_id,
          system_role = excluded.system_role,
          unread_count = excluded.unread_count,
          total_count = excluded.total_count,
          selectable = excluded.selectable,
          uid_next = excluded.uid_next
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
        mailbox.uidNext ?? null,
      );
  }

  listMailboxes(): StoredMailbox[] {
    return this.database
      .prepare(`
        SELECT id, name, path, parent_id, system_role, unread_count, total_count, selectable, uid_next
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
          uid_next: number | null;
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
          ...(mailbox.uid_next === null ? {} : { uidNext: mailbox.uid_next }),
        };
      });
  }

  saveMessage(message: StoredMessage): { inserted: boolean } {
    const existing = this.database.prepare("SELECT 1 FROM messages WHERE id = ?").get(message.id);

    this.database
      .prepare(`
        INSERT INTO messages (
          id, stable_identity, thread_id, subject, sender_json, recipients_json,
          cc_recipients_json, bcc_recipients_json, received_at,
          unread, starred, ai_processed, snippet, body_text, readable_body, plain_text_body,
          blocked_remote_image_count, updated_at, attachments_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          stable_identity = excluded.stable_identity,
          thread_id = excluded.thread_id,
          subject = excluded.subject,
          sender_json = excluded.sender_json,
          recipients_json = excluded.recipients_json,
          cc_recipients_json = excluded.cc_recipients_json,
          bcc_recipients_json = excluded.bcc_recipients_json,
          received_at = excluded.received_at,
          unread = excluded.unread,
          starred = excluded.starred,
          ai_processed = excluded.ai_processed,
          snippet = excluded.snippet,
          body_text = excluded.body_text,
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
        JSON.stringify(message.ccRecipients ?? []),
        JSON.stringify(message.bccRecipients ?? []),
        message.receivedAt,
        message.unread ? 1 : 0,
        message.starred ? 1 : 0,
        message.aiProcessed ? 1 : 0,
        message.snippet ?? "",
        message.bodyText ?? message.plainTextBody ?? stripHtml(message.readableBody),
        message.readableBody,
        message.plainTextBody ?? null,
        message.blockedRemoteImageCount ?? 0,
        message.updatedAt ?? message.receivedAt,
        JSON.stringify(message.attachments),
      );
    this.saveInlineMessageResources(message.id, message.inlineResources ?? []);

    return { inserted: existing === undefined };
  }

  private saveInlineMessageResources(messageId: string, resources: InlineMessageResource[]): void {
    this.database
      .prepare("DELETE FROM inline_message_resources WHERE message_id = ?")
      .run(messageId);

    const statement = this.database.prepare(`
      INSERT INTO inline_message_resources (id, message_id, content_id, mime_type, size_bytes, bytes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const resource of resources) {
      statement.run(
        `${messageId}:${resource.id}`,
        messageId,
        resource.contentId,
        resource.mimeType,
        resource.sizeBytes,
        resource.bytes,
      );
    }
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

  removeStaleMailboxEntries(
    messageId: string,
    syncedMailboxIds: string[],
    currentMailboxIds: string[],
  ): void {
    if (!syncedMailboxIds.length) {
      return;
    }

    const syncedPlaceholders = syncedMailboxIds.map(() => "?").join(", ");
    const currentPlaceholders = currentMailboxIds.map(() => "?").join(", ");
    const currentFilter = currentMailboxIds.length
      ? `AND mailbox_id NOT IN (${currentPlaceholders})`
      : "";

    this.database
      .prepare(`
        DELETE FROM mailbox_entries
        WHERE message_id = ?
          AND mailbox_id IN (${syncedPlaceholders})
          ${currentFilter}
      `)
      .run(messageId, ...syncedMailboxIds, ...currentMailboxIds);
  }

  removeMailboxEntriesMissingSince(
    mailboxIds: string[],
    since: string,
    reportedEntries: Array<{ messageId: string; mailboxId: string }>,
  ): number {
    if (!mailboxIds.length) {
      return 0;
    }

    const staleEntries = this.database
      .prepare(
        `
          SELECT mailbox_entries.message_id, mailbox_entries.mailbox_id
          FROM mailbox_entries
          INNER JOIN messages ON messages.id = mailbox_entries.message_id
          WHERE mailbox_entries.mailbox_id IN (${mailboxIds.map(() => "?").join(", ")})
            AND messages.received_at >= ?
        `,
      )
      .all(...mailboxIds, since) as Array<{ message_id: string; mailbox_id: string }>;
    const reported = new Set(
      reportedEntries.map((entry) => `${entry.messageId}\u0000${entry.mailboxId}`),
    );
    const statement = this.database.prepare(`
      DELETE FROM mailbox_entries
      WHERE message_id = ? AND mailbox_id = ?
    `);
    let removedCount = 0;

    for (const entry of staleEntries) {
      if (reported.has(`${entry.message_id}\u0000${entry.mailbox_id}`)) {
        continue;
      }

      statement.run(entry.message_id, entry.mailbox_id);
      removedCount += 1;
    }

    return removedCount;
  }

  saveMailboxSyncState(state: MailboxSyncState): void {
    const existing = this.getMailboxSyncState(state.mailboxId);

    this.database
      .prepare(`
        INSERT INTO mailbox_sync_states (mailbox_id, highest_uid, message_count, uid_next, last_synced_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(mailbox_id) DO UPDATE SET
          highest_uid = excluded.highest_uid,
          message_count = COALESCE(excluded.message_count, mailbox_sync_states.message_count),
          uid_next = COALESCE(excluded.uid_next, mailbox_sync_states.uid_next),
          last_synced_at = excluded.last_synced_at
      `)
      .run(
        state.mailboxId,
        Math.max(existing?.highestUid ?? 0, state.highestUid),
        state.messageCount ?? null,
        state.uidNext ?? null,
        state.lastSyncedAt,
      );
  }

  getMailboxSyncState(mailboxId: string): MailboxSyncState | undefined {
    const row = this.database
      .prepare(`
        SELECT mailbox_id, highest_uid, message_count, uid_next, last_synced_at
        FROM mailbox_sync_states
        WHERE mailbox_id = ?
      `)
      .get(mailboxId) as
      | {
          mailbox_id: string;
          highest_uid: number;
          message_count: number | null;
          uid_next: number | null;
          last_synced_at: string;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      mailboxId: row.mailbox_id,
      highestUid: row.highest_uid,
      ...(row.message_count === null ? {} : { messageCount: row.message_count }),
      ...(row.uid_next === null ? {} : { uidNext: row.uid_next }),
      lastSyncedAt: row.last_synced_at,
    };
  }

  removeMailboxEntry(messageId: string, mailboxId: string): void {
    const result = this.database
      .prepare(`
        DELETE FROM mailbox_entries
        WHERE message_id = ? AND mailbox_id = ?
      `)
      .run(messageId, mailboxId);

    if (result.changes === 0) {
      return;
    }

    const message = this.database
      .prepare("SELECT unread FROM messages WHERE id = ?")
      .get(messageId) as { unread: number } | undefined;

    if (message?.unread) {
      this.adjustMailboxUnreadCount(mailboxId, -1);
    }
  }

  adjustMailboxUnreadCount(mailboxId: string, delta: number): void {
    this.database
      .prepare(`
        UPDATE mailboxes
        SET unread_count = max(0, unread_count + ?)
        WHERE id = ?
      `)
      .run(delta, mailboxId);
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

  getInlineMessageResource(
    messageId: string,
    resourceId: string,
  ): InlineMessageResource | undefined {
    const row = this.database
      .prepare(`
        SELECT id, content_id, mime_type, size_bytes, bytes
        FROM inline_message_resources
        WHERE message_id = ? AND id IN (?, ?)
      `)
      .get(messageId, resourceId, `${messageId}:${resourceId}`) as
      | {
          id: string;
          content_id: string;
          mime_type: string;
          size_bytes: number;
          bytes: Uint8Array;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      contentId: row.content_id,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      bytes: row.bytes,
    };
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
          messages.sender_json, messages.recipients_json, messages.cc_recipients_json,
          messages.bcc_recipients_json, messages.received_at,
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
          cc_recipients_json: string;
          bcc_recipients_json: string;
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
          ccRecipients: JSON.parse(message.cc_recipients_json) as MessageParticipant[],
          bccRecipients: JSON.parse(message.bcc_recipients_json) as MessageParticipant[],
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
        SELECT id, stable_identity, thread_id, subject, sender_json, recipients_json,
          cc_recipients_json, bcc_recipients_json, received_at,
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
          cc_recipients_json: string;
          bcc_recipients_json: string;
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
      ccRecipients: JSON.parse(row.cc_recipients_json) as MessageParticipant[],
      bccRecipients: JSON.parse(row.bcc_recipients_json) as MessageParticipant[],
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
      inlineResources: this.listInlineMessageResources(row.id),
      attachments,
    };
  }

  listUnreadMessages(mailAccountId: string): AiMessageSummary[] {
    return this.database
      .prepare(`
        SELECT id, stable_identity, thread_id, subject, sender_json, recipients_json,
          cc_recipients_json, bcc_recipients_json, received_at,
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
          cc_recipients_json: string;
          bcc_recipients_json: string;
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
          ccRecipients: JSON.parse(message.cc_recipients_json) as MessageParticipant[],
          bccRecipients: JSON.parse(message.bcc_recipients_json) as MessageParticipant[],
          receivedAt: message.received_at,
          unread: Boolean(message.unread),
          starred: Boolean(message.starred),
          mailboxIds: this.listMailboxIdsForMessage(message.id),
          snippet: message.snippet,
          attachmentCount: attachments.length,
          updatedAt: message.updated_at || message.received_at,
        };
      })
      .filter(
        (message) => !message.mailboxIds.some((mailboxId) => isTrashLikeMailboxId(mailboxId)),
      );
  }

  searchMessages(mailAccountId: string, query: string): MessageSummary[] {
    const pattern = `%${query.toLowerCase()}%`;

    return this.database
      .prepare(`
        SELECT id, stable_identity, thread_id, subject, sender_json, recipients_json,
          cc_recipients_json, bcc_recipients_json, received_at,
          unread, starred, snippet, updated_at, attachments_json
        FROM messages
        WHERE lower(subject) LIKE ? OR lower(body_text) LIKE ?
        ORDER BY received_at DESC, id DESC
      `)
      .all(pattern, pattern)
      .map((row) => {
        const message = row as {
          id: string;
          stable_identity: string;
          thread_id: string | null;
          subject: string;
          sender_json: string;
          recipients_json: string;
          cc_recipients_json: string;
          bcc_recipients_json: string;
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
          ccRecipients: JSON.parse(message.cc_recipients_json) as MessageParticipant[],
          bccRecipients: JSON.parse(message.bcc_recipients_json) as MessageParticipant[],
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
        SELECT id, stable_identity, thread_id, subject, sender_json, recipients_json,
          cc_recipients_json, bcc_recipients_json, received_at,
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
          cc_recipients_json: string;
          bcc_recipients_json: string;
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
      ccRecipients: JSON.parse(row.cc_recipients_json) as MessageParticipant[],
      bccRecipients: JSON.parse(row.bcc_recipients_json) as MessageParticipant[],
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
      inlineResources: this.listInlineMessageResources(row.id),
      attachments,
    };
  }

  private listInlineMessageResources(messageId: string): InlineMessageResourceMetadata[] {
    return this.database
      .prepare(`
        SELECT id, content_id, mime_type, size_bytes
        FROM inline_message_resources
        WHERE message_id = ?
        ORDER BY id
      `)
      .all(messageId)
      .map((row) => {
        const resource = row as {
          id: string;
          content_id: string;
          mime_type: string;
          size_bytes: number;
        };

        return {
          id: resource.id.startsWith(`${messageId}:`)
            ? resource.id.slice(messageId.length + 1)
            : resource.id,
          contentId: resource.content_id,
          mimeType: resource.mime_type,
          sizeBytes: resource.size_bytes,
        };
      });
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

  if (
    filters.hasAttachments !== undefined &&
    message.attachmentCount > 0 !== filters.hasAttachments
  ) {
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

function stripHtml(value: string): string {
  return value
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function encodeMessageCursor(receivedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ receivedAt, id }), "utf8").toString("base64url");
}

function isTrashLikeMailboxId(mailboxId: string): boolean {
  const normalized = mailboxId.toLowerCase();

  return normalized === "trash" || normalized.endsWith("/trash");
}
