import type {
  AccountOpenResponse,
  AccountRefreshRequest,
  AccountRefreshResponse,
  LiveMessageDetail,
  LiveMessageSummary,
  LiveMessagePage,
  MessageParticipant,
  SystemMailboxRole,
} from "@zmail/shared";
import { ImapFlow } from "imapflow";
import type { ImapFlowOptions, MessageStructureObject } from "imapflow";
import type { Readable } from "node:stream";
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
  readMessage(
    account: ConfiguredMailAccount,
    messageId: string,
  ): Promise<LiveMessageDetail | undefined>;
  readInlineResource(
    account: ConfiguredMailAccount,
    messageId: string,
    resourceId: string,
  ): Promise<LiveMessageResource | undefined>;
  downloadAttachment(
    account: ConfiguredMailAccount,
    messageId: string,
    attachmentId: string,
  ): Promise<LiveAttachmentDownload | undefined>;
  closeAllSessions(): Promise<void>;
};

type LiveMessageResource = {
  mimeType: string;
  bytes: Uint8Array;
};

type LiveAttachmentDownload = {
  filename: string;
  mimeType: string;
  body: ReadableStream<Uint8Array>;
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
  fetchOne(
    range: string,
    query: {
      flags?: true;
      envelope?: true;
      internalDate?: true;
      threadId?: true;
      bodyStructure?: true;
      bodyParts?: string[];
    },
    options: { uid: true },
  ): Promise<
    | false
    | {
        uid?: number;
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
        bodyStructure?: MessageStructureObject;
        bodyParts?: Map<string, Buffer>;
      }
  >;
  download(
    range: string,
    part: string,
    options: { uid: true; maxBytes?: number },
  ): Promise<{
    meta: { contentType: string; filename?: string };
    content: Readable;
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
  const connect = async (
    account: ConfiguredMailAccount,
    boundedStream = false,
  ): Promise<ImapClientSession> => {
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
      ...(boundedStream ? { socketTimeout: 30_000 } : {}),
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
    readMessage: (account, messageId) =>
      coordinator.run(
        account.id,
        () => connect(account),
        async (session) => {
          const client = session.client as LiveImapClient;
          const located = await locateMessage(client, messageId);
          return located ? readMessageDetail(client, account.id, messageId, located) : undefined;
        },
      ),
    readInlineResource: (account, messageId, resourceId) =>
      coordinator.run(
        account.id,
        () => connect(account),
        async (session) => {
          const client = session.client as LiveImapClient;
          const located = await locateMessage(client, messageId);
          if (!located) {
            return undefined;
          }

          const part = inlineResourceParts(located.bodyStructure).find(
            (candidate) => partId(candidate.part) === resourceId,
          );
          if (!part?.part) {
            return undefined;
          }

          const downloaded = await client.download(String(located.uid), part.part, { uid: true });
          return {
            mimeType: part.type,
            bytes: await readStreamBytes(downloaded.content),
          };
        },
      ),
    async downloadAttachment(account, messageId, attachmentId) {
      const session = await connect(account, true);
      const client = session.client as LiveImapClient;

      try {
        const located = await locateMessage(client, messageId);
        if (!located) {
          await session.close();
          return undefined;
        }

        const part = attachmentParts(located.bodyStructure).find(
          (candidate) => partId(candidate.part) === attachmentId,
        );
        if (!part?.part) {
          await session.close();
          return undefined;
        }

        const downloaded = await client.download(String(located.uid), part.part, {
          uid: true,
          maxBytes: Math.max(1, part.size ?? 1),
        });

        return {
          filename: partFilename(part) ?? "attachment",
          mimeType: part.type,
          body: closingWebStream(downloaded.content, session.close),
        };
      } catch (error) {
        await closeClient(client);
        throw error;
      }
    },
    closeAllSessions: () => coordinator.closeAll(),
  };
}

async function listMailboxes(client: LiveImapClient) {
  return client.list({
    statusQuery: { unseen: true, messages: true },
  });
}

type LocatedMessage = {
  uid: number;
  emailId: string;
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
  bodyStructure: MessageStructureObject;
};

async function locateMessage(
  client: LiveImapClient,
  messageId: string,
): Promise<LocatedMessage | undefined> {
  const mailboxes = await listMailboxes(client);
  const uid = await findMessageUid(client, messageId, messageMailboxIds(mailboxes));
  if (uid === undefined) {
    return undefined;
  }

  const message = await client.fetchOne(
    String(uid),
    {
      flags: true,
      envelope: true,
      internalDate: true,
      threadId: true,
      bodyStructure: true,
    },
    { uid: true },
  );

  if (
    !message ||
    message.emailId !== messageId ||
    message.uid === undefined ||
    !message.bodyStructure
  ) {
    return undefined;
  }

  return {
    uid: message.uid,
    emailId: message.emailId,
    ...(message.threadId ? { threadId: message.threadId } : {}),
    ...(message.flags ? { flags: message.flags } : {}),
    ...(message.envelope ? { envelope: message.envelope } : {}),
    ...(message.internalDate ? { internalDate: message.internalDate } : {}),
    bodyStructure: message.bodyStructure,
  };
}

async function readMessageDetail(
  client: LiveImapClient,
  accountId: string,
  messageId: string,
  located: LocatedMessage,
): Promise<LiveMessageDetail> {
  const textParts = readableBodyParts(located.bodyStructure).filter(
    (part) =>
      (part.type.toLowerCase() === "text/plain" || part.type.toLowerCase() === "text/html") &&
      !isAttachmentPart(part),
  );
  const bodyPartIds = textParts.flatMap((part) => (part.part ? [part.part] : []));
  const bodyResponse =
    bodyPartIds.length > 0
      ? await client.fetchOne(String(located.uid), { bodyParts: bodyPartIds }, { uid: true })
      : false;
  const decodedBodyParts = new Map(
    textParts.map((part) => [
      part.type.toLowerCase(),
      decodeTextPart(
        bodyResponse && part.part ? bodyResponse.bodyParts?.get(part.part) : undefined,
        part,
      ),
    ]),
  );
  const readableBody = decodedBodyParts.get("text/html") ?? "";
  const plainTextBody = decodedBodyParts.get("text/plain");

  return {
    accountId,
    id: messageId,
    ...(located.threadId ? { threadId: located.threadId } : {}),
    subject: located.envelope?.subject ?? "(no subject)",
    sender: participant(located.envelope?.from?.[0]),
    recipients: (located.envelope?.to ?? []).map(participant),
    ccRecipients: (located.envelope?.cc ?? []).map(participant),
    bccRecipients: (located.envelope?.bcc ?? []).map(participant),
    receivedAt: normalizeDate(located.envelope?.date ?? located.internalDate).toISOString(),
    unread: !located.flags?.has("\\Seen"),
    starred: located.flags?.has("\\Flagged") === true,
    readableBody,
    ...(plainTextBody ? { plainTextBody } : {}),
    inlineResources: inlineResourceParts(located.bodyStructure).map((part) => ({
      id: partId(part.part),
      contentId: normalizeContentId(part.id ?? ""),
      mimeType: part.type,
      sizeBytes: part.size ?? 0,
    })),
    attachments: attachmentParts(located.bodyStructure).map((part) => ({
      id: partId(part.part),
      filename: partFilename(part) ?? "attachment",
      mimeType: part.type,
      sizeBytes: part.size ?? 0,
    })),
  };
}

function readableBodyParts(root: MessageStructureObject): MessageStructureObject[] {
  if (isAttachmentPart(root)) {
    return [];
  }
  if (!root.childNodes?.length) {
    return [root];
  }
  return root.childNodes.flatMap(readableBodyParts);
}

function inlineResourceParts(root: MessageStructureObject): MessageStructureObject[] {
  return readableBodyParts(root).filter(
    (part) =>
      Boolean(part.id) &&
      Boolean(part.part) &&
      part.type.toLowerCase() !== "text/plain" &&
      part.type.toLowerCase() !== "text/html",
  );
}

function attachmentParts(root: MessageStructureObject): MessageStructureObject[] {
  if (isAttachmentPart(root)) {
    return root.part ? [root] : [];
  }
  return root.childNodes?.flatMap(attachmentParts) ?? [];
}

function isAttachmentPart(part: MessageStructureObject): boolean {
  return part.disposition?.toLowerCase() === "attachment" || Boolean(partFilename(part));
}

function partFilename(part: MessageStructureObject): string | undefined {
  return part.dispositionParameters?.filename ?? part.parameters?.name;
}

function partId(part: string | undefined): string {
  return Buffer.from(part ?? "", "utf8").toString("base64url");
}

function normalizeContentId(value: string): string {
  return value.trim().replace(/^</, "").replace(/>$/, "");
}

function decodeTextPart(bytes: Buffer | undefined, part: MessageStructureObject): string {
  if (!bytes) {
    return "";
  }

  const encoding = part.encoding?.toLowerCase();
  let decoded = bytes;
  if (encoding === "base64") {
    decoded = Buffer.from(bytes.toString("ascii").replaceAll(/\s/g, ""), "base64");
  } else if (encoding === "quoted-printable") {
    decoded = decodeQuotedPrintable(bytes);
  }

  try {
    return new TextDecoder(part.parameters?.charset ?? "utf-8").decode(decoded);
  } catch {
    return decoded.toString("utf8");
  }
}

function decodeQuotedPrintable(bytes: Buffer): Buffer {
  const value = bytes.toString("binary").replaceAll(/=\r?\n/g, "");
  const decoded: number[] = [];

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "=" && /^[\da-f]{2}$/i.test(value.slice(index + 1, index + 3))) {
      decoded.push(Number.parseInt(value.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      decoded.push(value.charCodeAt(index));
    }
  }

  return Buffer.from(decoded);
}

async function readStreamBytes(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Uint8Array.from(Buffer.concat(chunks));
}

function closingWebStream(
  stream: Readable,
  close: () => Promise<void>,
): ReadableStream<Uint8Array> {
  const iterator = stream[Symbol.asyncIterator]();
  let closePromise: Promise<void> | undefined;
  const closeOnce = () => {
    closePromise ??= close().catch(() => undefined);
    return closePromise;
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          await closeOnce();
          return;
        }
        controller.enqueue(Uint8Array.from(next.value as Uint8Array));
      } catch (error) {
        controller.error(error);
        await closeOnce();
      }
    },
    async cancel() {
      stream.destroy();
      await iterator.return?.();
      await closeOnce();
    },
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

function messageMailboxIds(
  listedMailboxes: Awaited<ReturnType<LiveImapClient["list"]>>,
  currentMailboxId?: string,
): string[] {
  return [
    ...(currentMailboxId ? [currentMailboxId] : []),
    ...["allMail", "spam", "trash"].flatMap((role) =>
      listedMailboxes
        .filter((mailbox) => systemMailboxRole(mailbox.specialUse) === role)
        .map((mailbox) => mailbox.path),
    ),
  ];
}

async function findMessageUid(
  client: LiveImapClient,
  messageId: string,
  mailboxIds: string[],
): Promise<number | undefined> {
  for (const mailboxId of new Set(mailboxIds)) {
    await client.mailboxOpen(mailboxId, { readOnly: true });
    const matchingUids = (await client.search({ emailId: messageId }, { uid: true })) || [];
    if (matchingUids[0] !== undefined) {
      return matchingUids[0];
    }
  }

  return undefined;
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
  const uid = await findMessageUid(
    client,
    messageId,
    messageMailboxIds(listedMailboxes, currentMailboxId),
  );
  return uid === undefined
    ? undefined
    : (await readMessagesByUid(client, accountId, [uid])).find(
        (candidate) => candidate.id === messageId,
      );
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
