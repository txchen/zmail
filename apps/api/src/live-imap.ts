import type {
  AccountOpenResponse,
  AccountRefreshRequest,
  AccountRefreshResponse,
  LiveMessageSummary,
  LiveMessagePage,
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
  listMailbox(
    account: ConfiguredMailAccount,
    mailboxId: string,
    cursor?: string,
  ): Promise<LiveMessagePage>;
  listUnread(account: ConfiguredMailAccount, cursor?: string): Promise<LiveMessagePage>;
  refreshAccount(
    account: ConfiguredMailAccount,
    request: AccountRefreshRequest,
  ): Promise<AccountRefreshResponse>;
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
  mailboxOpen(
    path: string,
    options: { readOnly: true },
  ): Promise<{ exists?: number; uidValidity?: bigint | number | string }>;
  search(
    query: { all?: true; seen?: false; gmailRaw?: string; emailId?: string },
    options: { uid: true },
  ): Promise<false | number[]>;
  fetch(
    range: string,
    query: {
      flags: true;
      envelope: true;
      internalDate: true;
      threadId: true;
    },
    options?: { uid: true },
  ): AsyncIterable<{
    seq?: number;
    uid?: number;
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
  const connect = async (account: ConfiguredMailAccount): Promise<ImapClientSession> => {
    const client = new ImapFlowClient({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: {
        user: account.emailAddress,
        pass: account.appPassword,
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
  };

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

          const inboxPage = await readMessagePage(client, account.id, inbox.path, "mailbox");
          const mailboxes = mailboxSummaries(listedMailboxes);
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
              ...inboxPage,
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
    },
    listMailbox: (account, mailboxId, cursor) =>
      coordinator.run(
        account.id,
        () => connect(account),
        (session) =>
          readMessagePage(
            session.client as LiveImapClient,
            account.id,
            mailboxId,
            "mailbox",
            cursor,
          ),
      ),
    listUnread: (account, cursor) =>
      coordinator.run(
        account.id,
        () => connect(account),
        async (session) => {
          const client = session.client as LiveImapClient;
          const listedMailboxes = await listMailboxes(client);
          const allMail = listedMailboxes.find(
            (mailbox) => systemMailboxRole(mailbox.specialUse) === "allMail",
          );

          if (!allMail) {
            throw new Error("Gmail All Mail is not visible through IMAP");
          }

          return readMessagePage(client, account.id, allMail.path, "unread", cursor);
        },
      ),
    refreshAccount: (account, request) =>
      coordinator.run(
        account.id,
        () => connect(account),
        async (session) => {
          const client = session.client as LiveImapClient;
          const listedMailboxes = await listMailboxes(client);
          const mailboxes = mailboxSummaries(listedMailboxes);
          const allMail = mailboxes.find((mailbox) => mailbox.systemRole === "allMail");
          const inbox = mailboxes.find((mailbox) => mailbox.systemRole === "inbox");
          const mailboxId =
            request.view.kind === "mailbox"
              ? request.view.mailboxId
              : listedMailboxes.find(
                  (mailbox) => systemMailboxRole(mailbox.specialUse) === "allMail",
                )?.path;

          if (!mailboxId) {
            throw new Error("Gmail All Mail is not visible through IMAP");
          }

          const page = await readMessagePage(client, account.id, mailboxId, request.view.kind);
          let selectedMessage = request.selectedMessageId
            ? page.messages.find((message) => message.id === request.selectedMessageId)
            : undefined;

          if (request.selectedMessageId && !selectedMessage) {
            selectedMessage = await readMessageState(
              client,
              account.id,
              request.selectedMessageId,
              mailboxId,
              listedMailboxes,
            );
          }

          return {
            mailAccount: {
              id: account.id,
              emailAddress: account.emailAddress,
              unreadCount: allMail?.unreadCount ?? inbox?.unreadCount ?? 0,
              mailboxes,
            },
            view: {
              ...request.view,
              ...page,
            },
            ...(request.selectedMessageId ? { selectedMessageId: request.selectedMessageId } : {}),
            ...(selectedMessage ? { selectedMessage } : {}),
          };
        },
      ),
    closeAllSessions: () => coordinator.closeAll(),
  };
}

async function listMailboxes(client: LiveImapClient) {
  return client.list({
    statusQuery: { unseen: true, messages: true },
  });
}

function mailboxSummaries(listedMailboxes: Awaited<ReturnType<LiveImapClient["list"]>>) {
  return listedMailboxes.map((mailbox) => {
    const role = systemMailboxRole(mailbox.specialUse);

    return {
      id: mailbox.path,
      name: mailbox.name ?? mailbox.path,
      path: mailbox.path,
      ...(mailbox.parentPath ? { parentId: mailbox.parentPath } : {}),
      ...(role ? { systemRole: role } : {}),
      unreadCount: mailbox.status?.unseen ?? 0,
      totalCount: mailbox.status?.messages ?? 0,
      selectable: !mailbox.flags?.has("\\Noselect"),
    };
  });
}

type CursorScope = "mailbox" | "unread";

type LiveMessageCursor = {
  version: 1;
  accountId: string;
  scope: CursorScope;
  mailboxId: string;
  uidValidity: string;
  beforeUid: number;
};

async function readMessagePage(
  client: LiveImapClient,
  accountId: string,
  mailboxId: string,
  scope: CursorScope,
  encodedCursor?: string,
): Promise<LiveMessagePage> {
  const openedMailbox = await client.mailboxOpen(mailboxId, { readOnly: true });
  const uidValidity = String(openedMailbox.uidValidity ?? "");
  const cursor = encodedCursor ? decodeCursor(encodedCursor) : undefined;

  if (
    cursor &&
    (cursor.accountId !== accountId ||
      cursor.scope !== scope ||
      cursor.mailboxId !== mailboxId ||
      cursor.uidValidity !== uidValidity)
  ) {
    throw new Error("Invalid cursor");
  }

  if ((openedMailbox.exists ?? 0) === 0) {
    return { messages: [] };
  }

  const searchResult = await client.search(
    scope === "unread" ? { seen: false, gmailRaw: "-in:spam -in:trash" } : { all: true },
    { uid: true },
  );
  const matchingUids = searchResult || [];
  const eligibleUids = matchingUids
    .filter((uid) => !cursor || uid < cursor.beforeUid)
    .sort((first, second) => first - second);
  const pageUids = eligibleUids.slice(-50);
  const messages = await readMessagesByUid(client, accountId, pageUids);
  const oldestUid = pageUids[0];

  return {
    messages,
    ...(eligibleUids.length > pageUids.length && oldestUid !== undefined
      ? {
          nextCursor: encodeCursor({
            version: 1,
            accountId,
            scope,
            mailboxId,
            uidValidity,
            beforeUid: oldestUid,
          }),
        }
      : {}),
  };
}

async function readMessagesByUid(
  client: LiveImapClient,
  accountId: string,
  uids: number[],
): Promise<LiveMessageSummary[]> {
  const messages: Array<LiveMessageSummary & { uid: number }> = [];

  if (uids.length > 0) {
    for await (const message of client.fetch(
      uids.join(","),
      {
        flags: true,
        envelope: true,
        internalDate: true,
        threadId: true,
      },
      { uid: true },
    )) {
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
        uid: message.uid ?? 0,
      });
    }
  }

  const seenMessageIds = new Set<string>();
  return messages
    .sort((first, second) => second.uid - first.uid)
    .filter((message) => {
      if (seenMessageIds.has(message.id)) {
        return false;
      }
      seenMessageIds.add(message.id);
      return true;
    })
    .map(({ uid: _uid, ...message }) => message);
}

async function readMessageState(
  client: LiveImapClient,
  accountId: string,
  messageId: string,
  currentMailboxId: string,
  listedMailboxes: Awaited<ReturnType<LiveImapClient["list"]>>,
): Promise<LiveMessageSummary | undefined> {
  const candidateMailboxIds = [
    currentMailboxId,
    ...listedMailboxes
      .filter((mailbox) =>
        ["allMail", "spam", "trash"].includes(systemMailboxRole(mailbox.specialUse) ?? ""),
      )
      .map((mailbox) => mailbox.path),
  ];

  for (const mailboxId of new Set(candidateMailboxIds)) {
    await client.mailboxOpen(mailboxId, { readOnly: true });
    const matchingUids = (await client.search({ emailId: messageId }, { uid: true })) || [];
    const message = (await readMessagesByUid(client, accountId, matchingUids)).find(
      (candidate) => candidate.id === messageId,
    );

    if (message) {
      return message;
    }
  }

  return undefined;
}

function encodeCursor(cursor: LiveMessageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(encodedCursor: string): LiveMessageCursor {
  try {
    const cursor = JSON.parse(
      Buffer.from(encodedCursor, "base64url").toString("utf8"),
    ) as Partial<LiveMessageCursor>;

    if (
      cursor.version !== 1 ||
      typeof cursor.accountId !== "string" ||
      (cursor.scope !== "mailbox" && cursor.scope !== "unread") ||
      typeof cursor.mailboxId !== "string" ||
      typeof cursor.uidValidity !== "string" ||
      !Number.isSafeInteger(cursor.beforeUid) ||
      (cursor.beforeUid ?? 0) <= 0
    ) {
      throw new Error("Invalid cursor");
    }

    return cursor as LiveMessageCursor;
  } catch {
    throw new Error("Invalid cursor");
  }
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
