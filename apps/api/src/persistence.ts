import { DatabaseSync } from "node:sqlite";

export type AccountSyncStatus = "synced" | "syncing" | "stale" | "failing";

export type StoredMailAccount = {
  id: string;
  displayName: string;
  emailAddress: string;
  syncStatus: AccountSyncStatus;
};

export type StoredMailbox = {
  id: string;
  name: string;
};

export type StoredMessage = {
  id: string;
  stableIdentity: string;
  subject: string;
  unread: boolean;
  aiProcessed: boolean;
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
        display_name TEXT NOT NULL,
        email_address TEXT NOT NULL,
        sync_status TEXT NOT NULL
      )
    `);
  }

  saveMailAccount(account: StoredMailAccount): void {
    this.database
      .prepare(`
        INSERT INTO mail_accounts (id, display_name, email_address, sync_status)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          email_address = excluded.email_address,
          sync_status = excluded.sync_status
      `)
      .run(account.id, account.displayName, account.emailAddress, account.syncStatus);
  }

  listMailAccounts(): StoredMailAccount[] {
    return this.database
      .prepare(`
        SELECT id, display_name, email_address, sync_status
        FROM mail_accounts
        ORDER BY id
      `)
      .all()
      .map((row) => {
        const account = row as {
          id: string;
          display_name: string;
          email_address: string;
          sync_status: AccountSyncStatus;
        };

        return {
          id: account.id,
          displayName: account.display_name,
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
        name TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        stable_identity TEXT NOT NULL UNIQUE,
        subject TEXT NOT NULL,
        unread INTEGER NOT NULL,
        ai_processed INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mailbox_entries (
        id TEXT PRIMARY KEY,
        mailbox_id TEXT NOT NULL REFERENCES mailboxes(id),
        message_id TEXT NOT NULL REFERENCES messages(id),
        UNIQUE(mailbox_id, message_id)
      );
    `);
  }

  saveMailbox(mailbox: StoredMailbox): void {
    this.database
      .prepare(`
        INSERT INTO mailboxes (id, name)
        VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name
      `)
      .run(mailbox.id, mailbox.name);
  }

  saveMessage(message: StoredMessage): void {
    this.database
      .prepare(`
        INSERT INTO messages (id, stable_identity, subject, unread, ai_processed)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          stable_identity = excluded.stable_identity,
          subject = excluded.subject,
          unread = excluded.unread,
          ai_processed = excluded.ai_processed
      `)
      .run(
        message.id,
        message.stableIdentity,
        message.subject,
        message.unread ? 1 : 0,
        message.aiProcessed ? 1 : 0,
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

  listMessagesWithMailboxEntries(): MessageWithMailboxEntries[] {
    const messages = this.database
      .prepare(`
        SELECT id, stable_identity, subject, unread, ai_processed
        FROM messages
        ORDER BY id
      `)
      .all() as Array<{
      id: string;
      stable_identity: string;
      subject: string;
      unread: number;
      ai_processed: number;
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
      unread: Boolean(message.unread),
      aiProcessed: Boolean(message.ai_processed),
      mailboxEntries: entries
        .filter((entry) => entry.message_id === message.id)
        .map((entry) => ({
          id: entry.id,
          mailboxId: entry.mailbox_id,
          mailboxName: entry.mailbox_name,
        })),
    }));
  }
}
