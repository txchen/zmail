import { ImapFlow } from "imapflow";
import type { ImapFlowOptions } from "imapflow";
import { logInfo } from "./logger.js";
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
      cc?: ImapAddress[];
      bcc?: ImapAddress[];
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
      const startedAt = Date.now();
      logInfo("gmail.mailboxes.start", { accountId: account.id });
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
        logInfo("gmail.mailboxes.finish", {
          accountId: account.id,
          durationMs: Date.now() - startedAt,
          mailboxCount: mailboxes.length,
          selectableMailboxCount: mailboxes.filter((mailbox) => !isNonSelectableMailbox(mailbox))
            .length,
        });

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
    async listRecentMessages({ account, mailboxes: requestedMailboxes }) {
      const startedAt = Date.now();
      logInfo("gmail.messages.start", {
        accountId: account.id,
        requestedMailboxCount: requestedMailboxes.length,
        incrementalMailboxCount: requestedMailboxes.filter(
          (mailbox) => mailbox.afterUid !== undefined,
        ).length,
      });
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
        let fetchedMessageCount = 0;

        for (const mailbox of mailboxes.filter(
          (candidate) =>
            requestedMailboxes.some((requestedMailbox) => requestedMailbox.id === candidate.path) &&
            isInboxMailbox(candidate.path),
        )) {
          if (isNonSelectableMailbox(mailbox)) {
            continue;
          }

          const requestedMailbox = requestedMailboxes.find(
            (candidate) => candidate.id === mailbox.path,
          );
          const openedMailbox = await client.mailboxOpen(mailbox.path);
          const messageCount = openedMailbox.exists ?? 0;

          if (messageCount === 0) {
            logInfo("gmail.messages.mailbox.skip", {
              accountId: account.id,
              mailboxId: mailbox.path,
              reason: "empty",
            });
            continue;
          }

          const range =
            requestedMailbox?.afterUid !== undefined
              ? `${requestedMailbox.afterUid + 1}:*`
              : `${Math.max(1, messageCount - 9)}:*`;
          logInfo("gmail.messages.mailbox.fetch", {
            accountId: account.id,
            mailboxId: mailbox.path,
            range,
            messageCount,
            mode: requestedMailbox?.afterUid !== undefined ? "incremental" : "backfill",
          });
          for await (const message of client.fetch(
            range,
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
            fetchedMessageCount += 1;
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
            const receivedAt =
              normalizeDate(message.envelope?.date) ?? normalizeDate(message.internalDate);

            if (
              requestedMailbox?.since &&
              receivedAt &&
              receivedAt.getTime() < requestedMailbox.since.getTime()
            ) {
              continue;
            }

            messagesByIdentity.set(stableIdentity, {
              id,
              stableIdentity,
              threadId: message.threadId,
              subject: message.envelope?.subject ?? "(no subject)",
              sender: participantFromAddress(message.envelope?.from?.[0]),
              recipients: message.envelope?.to?.map(participantFromAddress),
              ccRecipients: message.envelope?.cc?.map(participantFromAddress),
              bccRecipients: message.envelope?.bcc?.map(participantFromAddress),
              receivedAt: (receivedAt ?? new Date()).toISOString(),
              unread: !message.flags?.has("\\Seen"),
              snippet: body.slice(0, 240),
              readableBody: body,
              plainTextBody: body,
              attachments: [],
              mailboxIds: [mailbox.path],
            });
          }
        }

        logInfo("gmail.messages.finish", {
          accountId: account.id,
          durationMs: Date.now() - startedAt,
          fetchedMessageCount,
          returnedMessageCount: messagesByIdentity.size,
        });
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

function isInboxMailbox(path: string): boolean {
  return path === "INBOX" || path.startsWith("INBOX/");
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

function normalizeDate(value: Date | string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(normalizeEmailDateString(value));

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date;
}

function normalizeEmailDateString(value: string): string {
  return value
    .replace(/\bCEST\b/, "+0200")
    .replace(/\bCET\b/, "+0100")
    .replace(/\bUTC\b/, "+0000")
    .replace(/\bGMT\b/, "+0000");
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
