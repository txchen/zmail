import type { ConfiguredMailAccount } from "./config.js";
import type { HybridPersistence, StoredMailbox } from "./persistence.js";

export type ImapMailbox = StoredMailbox;

export type MailboxSyncClient = {
  listVisibleMailboxes(account: ConfiguredMailAccount): Promise<ImapMailbox[]>;
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
    try {
      const mailboxes = await client.listVisibleMailboxes(account);
      const mailDatabase = persistence.mailDatabaseFor(account.id);

      for (const mailbox of mailboxes) {
        mailDatabase.saveMailbox(mailbox);
      }

      persistence.app.saveMailAccount({
        id: account.id,
        displayName: account.displayName,
        emailAddress: account.emailAddress,
        syncStatus: "synced",
      });
    } catch {
      persistence.app.saveMailAccount({
        id: account.id,
        displayName: account.displayName,
        emailAddress: account.emailAddress,
        syncStatus: "failing",
      });
    }
  }
}
