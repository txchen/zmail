import { ImapFlow } from "imapflow";
import type { ImapFlowOptions } from "imapflow";
import type { ImapMessage, MailboxSyncClient, MessageSyncClient } from "./sync.js";

type ImapFlowClient = {
  connect(): Promise<void>;
  list(options: { statusQuery: { unseen: true } }): Promise<
    Array<{
      path: string;
      flags?: Set<string>;
      status?: {
        unseen?: number;
      };
    }>
  >;
  mailboxOpen(path: string): Promise<{ exists?: number }>;
  fetch(
    range: string,
    query: {
      uid: true;
      flags: true;
      envelope: true;
      internalDate: true;
      source: { maxLength: 16384 };
      threadId: true;
    },
    options: { uid: true },
  ): AsyncIterable<{
    uid: number;
    emailId?: string;
    threadId?: string;
    flags?: Set<string>;
    envelope?: {
      subject?: string;
      date?: Date;
      from?: ImapAddress[];
      to?: ImapAddress[];
    };
    internalDate?: Date | string;
    source?: Buffer;
  }>;
  logout(): Promise<void>;
};

type ImapFlowConstructor = new (options: ImapFlowOptions) => ImapFlowClient;

type ImapAddress = {
  address?: string;
  name?: string;
};

export function createGmailImapMailboxSyncClient(
  ImapFlowClient: ImapFlowConstructor = ImapFlow,
): MailboxSyncClient & MessageSyncClient {
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
          selectable: !isNonSelectableMailbox(mailbox),
        }));
      } finally {
        await client.logout();
      }
    },
    async listRecentMessages({ account }) {
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
        const messagesByIdentity = new Map<string, ImapMessage>();

        for (const mailbox of mailboxes.filter((candidate) => candidate.path === "INBOX")) {
          if (isNonSelectableMailbox(mailbox)) {
            continue;
          }

          const openedMailbox = await client.mailboxOpen(mailbox.path);
          const messageCount = openedMailbox.exists ?? 0;

          if (messageCount === 0) {
            continue;
          }

          const startSequence = Math.max(1, messageCount - 9);
          for await (const message of client.fetch(
            `${startSequence}:*`,
            {
              uid: true,
              flags: true,
              envelope: true,
              internalDate: true,
              source: { maxLength: 16384 },
              threadId: true,
            },
            { uid: true },
          )) {
            const id = message.emailId ?? `${mailbox.path}:${message.uid}`;
            const stableIdentity = `gmail:${account.id}:${id}`;
            const existing = messagesByIdentity.get(stableIdentity);

            if (existing) {
              if (!existing.mailboxIds.includes(mailbox.path)) {
                existing.mailboxIds.push(mailbox.path);
              }
              continue;
            }

            const body = readableBodyFromSource(message.source);
            const receivedAt = normalizeDate(message.envelope?.date ?? message.internalDate);

            messagesByIdentity.set(stableIdentity, {
              id,
              stableIdentity,
              threadId: message.threadId,
              subject: message.envelope?.subject ?? "(no subject)",
              sender: participantFromAddress(message.envelope?.from?.[0]),
              recipients: message.envelope?.to?.map(participantFromAddress),
              receivedAt: receivedAt.toISOString(),
              unread: !message.flags?.has("\\Seen"),
              snippet: body.slice(0, 240),
              readableBody: body,
              plainTextBody: body,
              attachments: [],
              mailboxIds: [mailbox.path],
            });
          }
        }

        return [...messagesByIdentity.values()];
      } finally {
        await client.logout();
      }
    },
  };
}

function isNonSelectableMailbox(mailbox: { flags?: Set<string> }): boolean {
  return mailbox.flags?.has("\\Noselect") === true || mailbox.flags?.has("\\NonExistent") === true;
}

function participantFromAddress(address: ImapAddress | undefined): {
  address: string;
  displayName?: string;
} {
  return {
    address: address?.address ?? "",
    ...(address?.name ? { displayName: address.name } : {}),
  };
}

function normalizeDate(value: Date | string | undefined): Date {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return new Date();
  }

  return date;
}

function readableBodyFromSource(source: Buffer | undefined): string {
  if (!source) {
    return "";
  }

  const raw = source.toString("utf8");
  const body = raw.slice(Math.max(raw.indexOf("\r\n\r\n"), raw.indexOf("\n\n")) + 4).trim();

  return decodeQuotedPrintable(body);
}

function decodeQuotedPrintable(value: string): string {
  return value
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9a-fA-F]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}
