import { DatabaseSync } from "node:sqlite";

export type AccountSyncStatus = "synced" | "syncing" | "stale" | "failing";

export type StoredMailAccount = {
  id: string;
  emailAddress: string;
  syncStatus: AccountSyncStatus;
};

export type StoredMailbox = {
  id: string;
  name: string;
  unreadCount: number;
};

export type StoredMessage = {
  id: string;
  stableIdentity: string;
  subject: string;
  receivedAt: string;
  unread: boolean;
  starred: boolean;
  aiProcessed: boolean;
  readableBody: string;
  attachments: AttachmentMetadata[];
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

export type MailboxMessageSummary = Omit<StoredMessage, "aiProcessed" | "readableBody"> & {
  mailboxEntryId: string;
};

export type MessageDetail = Omit<StoredMessage, "aiProcessed">;

export type AiMessageSummary = Omit<StoredMessage, "aiProcessed" | "readableBody"> & {
  mailAccountId: string;
};

export type AiMessageDetail = MessageDetail & {
  mailAccountId: string;
};

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
        sync_status TEXT NOT NULL
      )
    `);
  }

  saveMailAccount(account: StoredMailAccount): void {
    this.database
      .prepare(`
        INSERT INTO mail_accounts (id, email_address, sync_status)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          email_address = excluded.email_address,
          sync_status = excluded.sync_status
      `)
      .run(account.id, account.emailAddress, account.syncStatus);
  }

  listMailAccounts(): StoredMailAccount[] {
    return this.database
      .prepare(`
        SELECT id, email_address, sync_status
        FROM mail_accounts
        ORDER BY id
      `)
      .all()
      .map((row) => {
        const account = row as {
          id: string;
          email_address: string;
          sync_status: AccountSyncStatus;
        };

        return {
          id: account.id,
          emailAddress: account.email_address,
          syncStatus: account.sync_status,
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
        unread_count INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        stable_identity TEXT NOT NULL UNIQUE,
        subject TEXT NOT NULL,
        received_at TEXT NOT NULL DEFAULT '',
        unread INTEGER NOT NULL,
        starred INTEGER NOT NULL DEFAULT 0,
        ai_processed INTEGER NOT NULL,
        readable_body TEXT NOT NULL DEFAULT '',
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
        INSERT INTO mailboxes (id, name, unread_count)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          unread_count = excluded.unread_count
      `)
      .run(mailbox.id, mailbox.name, mailbox.unreadCount);
  }

  listMailboxes(): StoredMailbox[] {
    return this.database
      .prepare(`
        SELECT id, name, unread_count
        FROM mailboxes
        ORDER BY id
      `)
      .all()
      .map((row) => {
        const mailbox = row as {
          id: string;
          name: string;
          unread_count: number;
        };

        return {
          id: mailbox.id,
          name: mailbox.name,
          unreadCount: mailbox.unread_count,
        };
      });
  }

  saveMessage(message: StoredMessage): void {
    this.database
      .prepare(`
        INSERT INTO messages (id, stable_identity, subject, received_at, unread, starred, ai_processed, readable_body, attachments_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          stable_identity = excluded.stable_identity,
          subject = excluded.subject,
          received_at = excluded.received_at,
          unread = excluded.unread,
          starred = excluded.starred,
          ai_processed = excluded.ai_processed,
          readable_body = excluded.readable_body,
          attachments_json = excluded.attachments_json
      `)
      .run(
        message.id,
        message.stableIdentity,
        message.subject,
        message.receivedAt,
        message.unread ? 1 : 0,
        message.starred ? 1 : 0,
        message.aiProcessed ? 1 : 0,
        message.readableBody,
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

  listMessagesForMailbox(mailboxId: string): MailboxMessageSummary[] {
    return this.database
      .prepare(`
        SELECT messages.id, messages.stable_identity, messages.subject, messages.received_at,
          messages.unread, messages.starred, messages.attachments_json, mailbox_entries.id AS mailbox_entry_id
        FROM mailbox_entries
        JOIN messages ON messages.id = mailbox_entries.message_id
        WHERE mailbox_entries.mailbox_id = ?
        ORDER BY messages.received_at DESC, messages.id
      `)
      .all(mailboxId)
      .map((row) => {
        const message = row as {
          id: string;
          stable_identity: string;
          subject: string;
          received_at: string;
          unread: number;
          starred: number;
          attachments_json: string;
          mailbox_entry_id: string;
        };

        return {
          id: message.id,
          stableIdentity: message.stable_identity,
          subject: message.subject,
          receivedAt: message.received_at,
          unread: Boolean(message.unread),
          starred: Boolean(message.starred),
          attachments: JSON.parse(message.attachments_json) as AttachmentMetadata[],
          mailboxEntryId: message.mailbox_entry_id,
        };
      });
  }

  getMessage(messageId: string): MessageDetail | null {
    const row = this.database
      .prepare(`
        SELECT id, stable_identity, subject, received_at, unread, starred, readable_body, attachments_json
        FROM messages
        WHERE id = ?
      `)
      .get(messageId) as
      | {
          id: string;
          stable_identity: string;
          subject: string;
          received_at: string;
          unread: number;
          starred: number;
          readable_body: string;
          attachments_json: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      stableIdentity: row.stable_identity,
      subject: row.subject,
      receivedAt: row.received_at,
      unread: Boolean(row.unread),
      starred: Boolean(row.starred),
      readableBody: row.readable_body,
      attachments: JSON.parse(row.attachments_json) as AttachmentMetadata[],
    };
  }

  listUnreadMessages(mailAccountId: string): AiMessageSummary[] {
    return this.database
      .prepare(`
        SELECT id, stable_identity, subject, received_at, unread, starred, attachments_json
        FROM messages
        WHERE unread = 1
        ORDER BY received_at DESC, id
      `)
      .all()
      .map((row) => {
        const message = row as {
          id: string;
          stable_identity: string;
          subject: string;
          received_at: string;
          unread: number;
          starred: number;
          attachments_json: string;
        };

        return {
          mailAccountId,
          id: message.id,
          stableIdentity: message.stable_identity,
          subject: message.subject,
          receivedAt: message.received_at,
          unread: Boolean(message.unread),
          starred: Boolean(message.starred),
          attachments: JSON.parse(message.attachments_json) as AttachmentMetadata[],
        };
      });
  }

  getMessageByStableIdentity(
    mailAccountId: string,
    stableIdentity: string,
  ): AiMessageDetail | null {
    const row = this.database
      .prepare(`
        SELECT id, stable_identity, subject, received_at, unread, starred, readable_body, attachments_json
        FROM messages
        WHERE stable_identity = ?
      `)
      .get(stableIdentity) as
      | {
          id: string;
          stable_identity: string;
          subject: string;
          received_at: string;
          unread: number;
          starred: number;
          readable_body: string;
          attachments_json: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      mailAccountId,
      id: row.id,
      stableIdentity: row.stable_identity,
      subject: row.subject,
      receivedAt: row.received_at,
      unread: Boolean(row.unread),
      starred: Boolean(row.starred),
      readableBody: row.readable_body,
      attachments: JSON.parse(row.attachments_json) as AttachmentMetadata[],
    };
  }
}
