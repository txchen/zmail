import type {
  AccountOpenResponse,
  LiveMessageSummary,
  MessageParticipant,
  SystemMailboxRole,
} from "@zmail/shared";
import { ImapFlow } from "imapflow";
import type { ImapFlowOptions } from "imapflow";
import type { ConfiguredMailAccount } from "./config.js";
import {
  createImapSessionCoordinator,
  type ImapClientSession,
  type ImapSessionCoordinator,
} from "./imap-session-coordinator.js";
import { logInfo } from "./logger.js";

export type GmailImapReader = {
  openAccount(account: ConfiguredMailAccount): Promise<AccountOpenResponse>;
  closeAllSessions(): Promise<void>;
};

type LiveImapClient = {
  connect(): Promise<void>;
  list(options: { statusQuery: { unseen: true; messages: true } }): Promise<
    Array<{
      path: string;
      name?: string;
      parentPath?: string;
      flags?: Set<string>;
      specialUse?: string;
      status?: { unseen?: number; messages?: number };
    }>
  >;
  mailboxOpen(path: string, options: { readOnly: true }): Promise<{ exists?: number }>;
  fetch(
    range: string,
    query: {
      flags: true;
      envelope: true;
      internalDate: true;
      threadId: true;
    },
  ): AsyncIterable<{
    seq?: number;
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
  }>;
  logout(): Promise<void>;
};

type ImapAddress = {
  address?: string;
  name?: string;
};

type ImapFlowConstructor = new (options: ImapFlowOptions) => LiveImapClient;

export function createGmailImapReader(
  ImapFlowClient: ImapFlowConstructor = ImapFlow,
  coordinator: ImapSessionCoordinator<ImapClientSession> = createImapSessionCoordinator(),
): GmailImapReader {
  return {
    async openAccount(account) {
      const startedAt = Date.now();
      logInfo("gmail.account.open.start", { accountId: account.id });

      const response = await coordinator.run(
        account.id,
        () => connect(account),
        async (session) => {
          const client = session.client as LiveImapClient;
          const listedMailboxes = await client.list({
            statusQuery: { unseen: true, messages: true },
          });
          const inbox = listedMailboxes.find(
            (mailbox) =>
              mailbox.specialUse?.toLowerCase() === "\\inbox" ||
              mailbox.path.toLowerCase() === "inbox",
          );

          if (!inbox) {
            throw new Error("Gmail Inbox is not visible through IMAP");
          }

          const openedInbox = await client.mailboxOpen(inbox.path, { readOnly: true });
          const inboxMessageCount = openedInbox.exists ?? inbox.status?.messages ?? 0;
          const messages =
            inboxMessageCount === 0
              ? []
              : await readInboxPage(
                  client,
                  account.id,
                  Math.max(1, inboxMessageCount - 49),
                  inboxMessageCount,
                );
          const mailboxes = listedMailboxes.map((mailbox) => ({
            id: mailbox.path,
            name: mailbox.name ?? mailbox.path,
            path: mailbox.path,
            ...(mailbox.parentPath ? { parentId: mailbox.parentPath } : {}),
            ...(systemMailboxRole(mailbox.specialUse)
              ? {
                  systemRole: systemMailboxRole(mailbox.specialUse),
                }
              : {}),
            unreadCount: mailbox.status?.unseen ?? 0,
            totalCount: mailbox.status?.messages ?? 0,
            selectable: !mailbox.flags?.has("\\Noselect"),
          }));
          const allMail = mailboxes.find((mailbox) => mailbox.systemRole === "allMail");
          const inboxSummary = mailboxes.find((mailbox) => mailbox.id === inbox.path);

          return {
            mailAccount: {
              id: account.id,
              emailAddress: account.emailAddress,
              unreadCount: allMail?.unreadCount ?? inboxSummary?.unreadCount ?? 0,
              mailboxes,
            },
            inbox: {
              mailboxId: inbox.path,
              messages,
            },
          };
        },
      );

      logInfo("gmail.account.open.finish", {
        accountId: account.id,
        durationMs: Date.now() - startedAt,
        mailboxCount: response.mailAccount.mailboxes.length,
        messageCount: response.inbox.messages.length,
      });
      return response;

      async function connect(configuredAccount: ConfiguredMailAccount): Promise<ImapClientSession> {
        const client = new ImapFlowClient({
          host: "imap.gmail.com",
          port: 993,
          secure: true,
          auth: {
            user: configuredAccount.emailAddress,
            pass: configuredAccount.appPassword,
          },
          disableAutoIdle: true,
          logger: false,
        });

        try {
          await client.connect();
        } catch (error) {
          await closeClient(client);
          throw error;
        }

        return {
          client,
          close: () => client.logout(),
        };
      }
    },
    closeAllSessions: () => coordinator.closeAll(),
  };
}

async function readInboxPage(
  client: LiveImapClient,
  accountId: string,
  firstSequence: number,
  lastSequence: number,
): Promise<LiveMessageSummary[]> {
  const messages: Array<LiveMessageSummary & { sequence: number }> = [];

  for await (const message of client.fetch(`${firstSequence}:${lastSequence}`, {
    flags: true,
    envelope: true,
    internalDate: true,
    threadId: true,
  })) {
    if (!message.emailId) {
      throw new Error("Gmail Message is missing X-GM-MSGID");
    }

    messages.push({
      accountId,
      id: message.emailId,
      ...(message.threadId ? { threadId: message.threadId } : {}),
      subject: message.envelope?.subject ?? "(no subject)",
      sender: participant(message.envelope?.from?.[0]),
      recipients: (message.envelope?.to ?? []).map(participant),
      receivedAt: normalizeDate(message.envelope?.date ?? message.internalDate).toISOString(),
      unread: !message.flags?.has("\\Seen"),
      starred: message.flags?.has("\\Flagged") === true,
      sequence: message.seq ?? 0,
    });
  }

  return messages
    .sort((first, second) => second.sequence - first.sequence)
    .map(({ sequence: _sequence, ...message }) => message);
}

function participant(address: ImapAddress | undefined): MessageParticipant {
  return {
    address: address?.address ?? "",
    ...(address?.name ? { displayName: address.name } : {}),
  };
}

function normalizeDate(value: Date | string | undefined): Date {
  if (!value) {
    return new Date(0);
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function systemMailboxRole(specialUse: string | undefined): SystemMailboxRole | undefined {
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

async function closeClient(client: LiveImapClient): Promise<void> {
  try {
    await client.logout();
  } catch {
    // The failed connection is already unusable.
  }
}
