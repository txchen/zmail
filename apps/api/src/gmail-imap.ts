import { ImapFlow } from "imapflow";
import type { ImapFlowOptions } from "imapflow";
import type { MailboxSyncClient } from "./sync.js";

type ImapFlowClient = {
  connect(): Promise<void>;
  list(options: { statusQuery: { unseen: true } }): Promise<
    Array<{
      path: string;
      status?: {
        unseen?: number;
      };
    }>
  >;
  logout(): Promise<void>;
};

type ImapFlowConstructor = new (options: ImapFlowOptions) => ImapFlowClient;

export function createGmailImapMailboxSyncClient(
  ImapFlowClient: ImapFlowConstructor = ImapFlow,
): MailboxSyncClient {
  return {
    async listVisibleMailboxes(account) {
      const client = new ImapFlowClient({
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        auth: {
          user: account.emailAddress,
          pass: account.appPassword,
        },
        logger: false,
      });

      await client.connect();

      try {
        const mailboxes = await client.list({ statusQuery: { unseen: true } });

        return mailboxes.map((mailbox) => ({
          id: mailbox.path,
          name: mailbox.path,
          unreadCount: mailbox.status?.unseen ?? 0,
        }));
      } finally {
        await client.logout();
      }
    },
  };
}
