import type {
  AccountOpenResponse,
  AccountRefreshRequest,
  AccountRefreshResponse,
  MailboxAction,
  MailboxActionConfirmation,
  MailboxActionMessageState,
  LiveMessageDetail,
  LiveMessageSummary,
  LiveMessagePage,
  MessageParticipant,
  SystemMailboxRole,
} from "@zmail/shared";
import { ImapFlow } from "imapflow";
import type { ImapFlowOptions, MessageStructureObject } from "imapflow";
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import type { ConfiguredMailAccount } from "./config.js";
import {
  createImapSessionCoordinator,
  type ImapClientSession,
  type ImapSessionCoordinator,
} from "./imap-session-coordinator.js";
import { logInfo, logWarn } from "./logger.js";

export type GmailImapReader = {
  openAccount(account: ConfiguredMailAccount): Promise<AccountOpenResponse>;
  listMailbox(
    account: ConfiguredMailAccount,
    mailboxId: string,
    cursor?: string,
  ): Promise<LiveMessagePage>;
  listUnread(account: ConfiguredMailAccount, cursor?: string): Promise<LiveMessagePage>;
  search(account: ConfiguredMailAccount, query: string, cursor?: string): Promise<LiveMessagePage>;
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
  performMailboxAction(
    account: ConfiguredMailAccount,
    messageId: string,
    action: MailboxAction,
  ): Promise<MailboxActionConfirmation>;
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
    options: { readOnly: boolean },
  ): Promise<{ exists?: number; uidValidity?: bigint | number | string }>;
  search(
    query: { all?: true; seen?: false; gmailRaw?: string; emailId?: string },
    options: { uid: true },
  ): Promise<false | number[]>;
  fetch(
    range: string,
    query: {
      flags?: true;
      envelope?: true;
      internalDate?: true;
      threadId?: true;
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
      labels?: true;
    },
    options: { uid: true },
  ): Promise<
    | false
    | {
        uid?: number;
        emailId?: string;
        threadId?: string;
        flags?: Set<string>;
        labels?: Set<string>;
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
  messageFlagsAdd(
    range: string,
    flags: string[],
    options: { uid: true; useLabels?: true },
  ): Promise<boolean>;
  messageFlagsRemove(
    range: string,
    flags: string[],
    options: { uid: true; useLabels?: true },
  ): Promise<boolean>;
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
  const attachmentSessions = new Set<ImapClientSession>();
  const attachmentConnections = new Set<Promise<ImapClientSession>>();
  let closingAttachmentSessions = false;
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

  const connectAttachment = async (account: ConfiguredMailAccount): Promise<ImapClientSession> => {
    if (closingAttachmentSessions) {
      throw new Error("IMAP sessions are closing");
    }

    const connection = (async () => {
      const connected = await connect(account, true);
      let closed = false;
      const session: ImapClientSession = {
        client: connected.client,
        async close() {
          if (closed) {
            return;
          }
          closed = true;
          attachmentSessions.delete(session);
          await connected.close();
        },
      };

      if (closingAttachmentSessions) {
        await closeSessionWithoutError(session);
        throw new Error("IMAP sessions are closing");
      }

      attachmentSessions.add(session);
      return session;
    })();
    attachmentConnections.add(connection);

    try {
      return await connection;
    } finally {
      attachmentConnections.delete(connection);
    }
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
    search: (account, query, cursor) =>
      coordinator.run(
        account.id,
        () => connect(account),
        async (session) => {
          const client = session.client as LiveImapClient;
          const listedMailboxes = await listMailboxes(client);
          return readSearchPage(client, account.id, listedMailboxes, query, cursor);
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
      const session = await connectAttachment(account);
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
        await closeSessionWithoutError(session);
        throw error;
      }
    },
    performMailboxAction: (account, messageId, action) =>
      coordinator.run(
        account.id,
        () => connect(account),
        async (session) => {
          const client = session.client as LiveImapClient;
          const listedMailboxes = await listMailboxes(client);
          const located = await findWritableMessageUid(
            client,
            messageId,
            messageMailboxIds(listedMailboxes),
          );

          if (!located) {
            throw new Error("Message not found");
          }

          const uid = String(located.uid);
          const fetchedState = await client.fetchOne(
            uid,
            { flags: true, labels: true },
            { uid: true },
          );
          if (!fetchedState) {
            throw new Error("Message not found");
          }
          const before = mailboxActionState(
            fetchedState.flags,
            fetchedState.labels,
            listedMailboxes,
          );
          if (action === "markRead") {
            requireStored(await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true }));
          } else if (action === "markUnread") {
            requireStored(await client.messageFlagsRemove(uid, ["\\Seen"], { uid: true }));
          } else if (action === "star") {
            requireStored(await client.messageFlagsAdd(uid, ["\\Flagged"], { uid: true }));
          } else if (action === "unstar") {
            requireStored(await client.messageFlagsRemove(uid, ["\\Flagged"], { uid: true }));
          } else if (action === "archive") {
            const inbox = listedMailboxes.find(
              (mailbox) => systemMailboxRole(mailbox.specialUse) === "inbox",
            );
            if (!inbox) {
              throw new Error("Gmail Inbox is not visible through IMAP");
            }
            requireStored(
              await client.messageFlagsRemove(uid, ["\\Inbox"], { uid: true, useLabels: true }),
            );
          } else {
            const trash = listedMailboxes.find(
              (mailbox) => systemMailboxRole(mailbox.specialUse) === "trash",
            );
            if (!trash) {
              throw new Error("Gmail Trash is not visible through IMAP");
            }
            requireStored(
              await client.messageFlagsAdd(uid, ["\\Trash"], { uid: true, useLabels: true }),
            );
          }
          return {
            accountId: account.id,
            messageId,
            action,
            before,
            after: targetMailboxActionState(before, action, listedMailboxes),
          };
        },
      ),
    async closeAllSessions() {
      closingAttachmentSessions = true;
      try {
        await Promise.allSettled([coordinator.closeAll(), ...attachmentConnections]);
        await Promise.allSettled(
          [...attachmentSessions].map((session) => closeSessionWithoutError(session)),
        );
      } finally {
        closingAttachmentSessions = false;
      }
    },
  };
}

function requireStored(stored: boolean): void {
  if (!stored) {
    throw new Error("Gmail did not confirm the target state");
  }
}

function mailboxActionState(
  flags: Set<string> | undefined,
  labels: Set<string> | undefined,
  listedMailboxes: Awaited<ReturnType<LiveImapClient["list"]>>,
): MailboxActionMessageState {
  const normalizedLabels = new Set([...(labels ?? [])].map((label) => label.toLowerCase()));
  const systemMailboxRoles: MailboxActionMessageState["systemMailboxRoles"] = [];
  if (normalizedLabels.has("\\inbox")) {
    systemMailboxRoles.push("inbox");
  }
  if (normalizedLabels.has("\\spam")) {
    systemMailboxRoles.push("spam");
  }
  if (normalizedLabels.has("\\trash")) {
    systemMailboxRoles.push("trash");
  }
  if (flags?.has("\\Flagged")) {
    systemMailboxRoles.push("flagged");
  }
  if (!systemMailboxRoles.includes("spam") && !systemMailboxRoles.includes("trash")) {
    systemMailboxRoles.push("allMail");
  }
  const mailboxIds = listedMailboxes.flatMap((mailbox) => {
    const role = systemMailboxRole(mailbox.specialUse);
    const member =
      (role === "inbox" && systemMailboxRoles.includes("inbox")) ||
      (role === "spam" && systemMailboxRoles.includes("spam")) ||
      (role === "trash" && systemMailboxRoles.includes("trash")) ||
      (role === "flagged" && systemMailboxRoles.includes("flagged")) ||
      (role === "allMail" && systemMailboxRoles.includes("allMail")) ||
      (role === "sent" && normalizedLabels.has("\\sent")) ||
      (role === "drafts" &&
        (normalizedLabels.has("\\draft") || normalizedLabels.has("\\drafts"))) ||
      normalizedLabels.has(mailbox.path.toLowerCase()) ||
      normalizedLabels.has((mailbox.name ?? mailbox.path).toLowerCase());
    return member ? [mailbox.path] : [];
  });
  return {
    unread: !flags?.has("\\Seen"),
    starred: flags?.has("\\Flagged") === true,
    mailboxIds,
    systemMailboxRoles,
  };
}

function targetMailboxActionState(
  before: MailboxActionMessageState,
  action: MailboxAction,
  listedMailboxes: Awaited<ReturnType<LiveImapClient["list"]>>,
): MailboxActionMessageState {
  const roles = new Set(before.systemMailboxRoles);
  const mailboxIds = new Set(before.mailboxIds);
  let unread = before.unread;
  let starred = before.starred;
  if (action === "markRead") {
    unread = false;
  } else if (action === "markUnread") {
    unread = true;
  } else if (action === "star") {
    starred = true;
    roles.add("flagged");
    addRoleMailboxIds(mailboxIds, listedMailboxes, "flagged");
  } else if (action === "unstar") {
    starred = false;
    roles.delete("flagged");
    removeRoleMailboxIds(mailboxIds, listedMailboxes, "flagged");
  } else if (action === "archive") {
    roles.delete("inbox");
    removeRoleMailboxIds(mailboxIds, listedMailboxes, "inbox");
  } else {
    roles.delete("inbox");
    roles.delete("spam");
    roles.delete("allMail");
    roles.add("trash");
    mailboxIds.clear();
    addRoleMailboxIds(mailboxIds, listedMailboxes, "trash");
  }
  return {
    unread,
    starred,
    mailboxIds: [...mailboxIds],
    systemMailboxRoles: [...roles],
  };
}

function addRoleMailboxIds(
  mailboxIds: Set<string>,
  listedMailboxes: Awaited<ReturnType<LiveImapClient["list"]>>,
  role: SystemMailboxRole,
): void {
  for (const mailbox of listedMailboxes) {
    if (systemMailboxRole(mailbox.specialUse) === role) {
      mailboxIds.add(mailbox.path);
    }
  }
}

function removeRoleMailboxIds(
  mailboxIds: Set<string>,
  listedMailboxes: Awaited<ReturnType<LiveImapClient["list"]>>,
  role: SystemMailboxRole,
): void {
  for (const mailbox of listedMailboxes) {
    if (systemMailboxRole(mailbox.specialUse) === role) {
      mailboxIds.delete(mailbox.path);
    }
  }
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

async function findWritableMessageUid(
  client: LiveImapClient,
  messageId: string,
  mailboxIds: string[],
): Promise<{ uid: number; mailboxId: string } | undefined> {
  for (const mailboxId of new Set(mailboxIds)) {
    await client.mailboxOpen(mailboxId, { readOnly: false });
    const matchingUids = (await client.search({ emailId: messageId }, { uid: true })) || [];
    if (matchingUids[0] !== undefined) {
      return { uid: matchingUids[0], mailboxId };
    }
  }

  return undefined;
}

type SearchSystemMailboxRole = Extract<SystemMailboxRole, "allMail" | "spam" | "trash">;

type SearchCursorMailbox = {
  mailboxId: string;
  uidValidity: string;
  upperUid: number;
};

type SearchCursor = {
  version: 2;
  accountId: string;
  queryHash: string;
  mailboxes: Partial<Record<SearchSystemMailboxRole, SearchCursorMailbox>>;
  lastReceivedAt: string;
  lastMessageId: string;
};

async function readSearchPage(
  client: LiveImapClient,
  accountId: string,
  listedMailboxes: Awaited<ReturnType<LiveImapClient["list"]>>,
  query: string,
  encodedCursor?: string,
): Promise<LiveMessagePage> {
  const queryHash = createHash("sha256").update(query).digest("base64url");
  const cursor = encodedCursor ? decodeSearchCursor(encodedCursor) : undefined;
  if (cursor && (cursor.accountId !== accountId || cursor.queryHash !== queryHash)) {
    throw new Error("Invalid cursor");
  }

  const includedRoles = searchIncludedRoles(query);
  if (cursor && [...includedRoles].some((role) => cursor.mailboxes[role] === undefined)) {
    throw new Error("Invalid cursor");
  }
  const candidates: MessageSortKey[] = [];
  const nextMailboxes: SearchCursor["mailboxes"] = {};

  for (const role of ["allMail", "spam", "trash"] as const) {
    const mailbox = listedMailboxes.find(
      (candidate) => systemMailboxRole(candidate.specialUse) === role,
    );
    if (!mailbox) {
      throw new Error(`Gmail ${role} Mailbox is not visible through IMAP`);
    }

    const opened = await client.mailboxOpen(mailbox.path, { readOnly: true });
    const uidValidity = String(opened.uidValidity ?? "");
    const previous = cursor?.mailboxes[role];
    if (previous && (previous.mailboxId !== mailbox.path || previous.uidValidity !== uidValidity)) {
      throw new Error("Invalid cursor");
    }

    const searchResult = await client.search({ gmailRaw: query }, { uid: true });
    const matchingUids = (searchResult || []).sort((first, second) => first - second);
    if (!includedRoles.has(role)) {
      continue;
    }

    const upperUid = previous?.upperUid ?? matchingUids.at(-1) ?? 0;
    const snapshotUids = matchingUids.filter((uid) => uid <= upperUid);
    nextMailboxes[role] = {
      mailboxId: mailbox.path,
      uidValidity,
      upperUid,
    };
    candidates.push(
      ...(await fetchMessageSortKeysByUid(client, accountId, mailbox.path, snapshotUids)),
    );
  }

  const eligible = deduplicateSortedKeys(candidates).filter(
    (candidate) =>
      !cursor ||
      compareSortTuple(candidate, {
        receivedAt: cursor.lastReceivedAt,
        id: cursor.lastMessageId,
      }) > 0,
  );
  const pageKeys = eligible.slice(0, 50);
  const messages = await fetchCurrentPageSummaries(client, accountId, pageKeys);
  const last = pageKeys.at(-1);

  return {
    messages,
    ...(eligible.length > pageKeys.length && last
      ? {
          nextCursor: encodeSearchCursor({
            version: 2,
            accountId,
            queryHash,
            mailboxes: nextMailboxes,
            lastReceivedAt: last.receivedAt,
            lastMessageId: last.id,
          }),
        }
      : {}),
  };
}

function searchIncludedRoles(query: string): Set<SearchSystemMailboxRole> {
  const roles = new Set<SearchSystemMailboxRole>(["allMail"]);
  const operators = queryOutsideQuotedLiterals(query);
  if (hasPositiveScopeOperator(operators, "anywhere")) {
    roles.add("spam");
    roles.add("trash");
  }
  if (hasPositiveScopeOperator(operators, "spam")) {
    roles.add("spam");
  }
  if (hasPositiveScopeOperator(operators, "trash")) {
    roles.add("trash");
  }
  return roles;
}

function queryOutsideQuotedLiterals(query: string): string {
  let quoted = false;
  let escaped = false;
  return [...query]
    .map((character) => {
      if (escaped) {
        escaped = false;
        return quoted ? " " : character;
      }
      if (character === "\\") {
        escaped = true;
        return quoted ? " " : character;
      }
      if (character === '"') {
        quoted = !quoted;
        return " ";
      }
      return quoted ? " " : character;
    })
    .join("");
}

function hasPositiveScopeOperator(query: string, scope: "anywhere" | "spam" | "trash"): boolean {
  return new RegExp(`(?:^|[\\s({])in:${scope}(?=$|[\\s)}])`, "i").test(query);
}

function encodeSearchCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeSearchCursor(encodedCursor: string): SearchCursor {
  try {
    const cursor = JSON.parse(
      Buffer.from(encodedCursor, "base64url").toString("utf8"),
    ) as SearchCursor;
    if (
      cursor.version !== 2 ||
      typeof cursor.accountId !== "string" ||
      typeof cursor.queryHash !== "string" ||
      !cursor.mailboxes ||
      typeof cursor.lastReceivedAt !== "string" ||
      typeof cursor.lastMessageId !== "string" ||
      Number.isNaN(Date.parse(cursor.lastReceivedAt))
    ) {
      throw new Error("Invalid cursor");
    }
    for (const state of Object.values(cursor.mailboxes)) {
      if (
        !state ||
        typeof state.mailboxId !== "string" ||
        typeof state.uidValidity !== "string" ||
        !Number.isSafeInteger(state.upperUid) ||
        state.upperUid < 0
      ) {
        throw new Error("Invalid cursor");
      }
    }
    return cursor;
  } catch {
    throw new Error("Invalid cursor");
  }
}

type CursorScope = "mailbox" | "unread";

type LiveMessageCursor = {
  version: 2;
  accountId: string;
  scope: CursorScope;
  mailboxId: string;
  uidValidity: string;
  upperUid: number;
  lastReceivedAt: string;
  lastMessageId: string;
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
  const upperUid =
    cursor?.upperUid ?? matchingUids.reduce((highestUid, uid) => Math.max(highestUid, uid), 0);
  const snapshotUids = matchingUids.filter((uid) => uid <= upperUid);
  const keys = await fetchMessageSortKeysByUid(client, accountId, mailboxId, snapshotUids);
  const eligible = deduplicateSortedKeys(keys).filter(
    (candidate) =>
      !cursor ||
      compareSortTuple(candidate, {
        receivedAt: cursor.lastReceivedAt,
        id: cursor.lastMessageId,
      }) > 0,
  );
  const pageKeys = eligible.slice(0, 50);
  const messages = await fetchCurrentPageSummaries(client, accountId, pageKeys, mailboxId);
  const last = pageKeys.at(-1);

  return {
    messages,
    ...(eligible.length > pageKeys.length && last
      ? {
          nextCursor: encodeCursor({
            version: 2,
            accountId,
            scope,
            mailboxId,
            uidValidity,
            upperUid,
            lastReceivedAt: last.receivedAt,
            lastMessageId: last.id,
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
  const messages = await fetchMessageSummariesByUid(client, accountId, uids);
  const seenMessageIds = new Set<string>();
  return messages
    .sort(compareMessageSummaries)
    .filter((message) => {
      if (seenMessageIds.has(message.id)) {
        return false;
      }
      seenMessageIds.add(message.id);
      return true;
    })
    .map(({ uid: _uid, ...message }) => message);
}

type MessageSortKey = {
  mailboxId: string;
  uid: number;
  id: string;
  receivedAt: string;
};

async function fetchMessageSortKeysByUid(
  client: LiveImapClient,
  accountId: string,
  mailboxId: string,
  uids: number[],
): Promise<MessageSortKey[]> {
  const keys: MessageSortKey[] = [];
  let skippedCount = 0;
  if (uids.length === 0) {
    return keys;
  }

  for await (const message of client.fetch(uids.join(","), { internalDate: true }, { uid: true })) {
    if (!message.emailId || message.uid === undefined) {
      skippedCount += 1;
      continue;
    }
    keys.push({
      mailboxId,
      uid: message.uid,
      id: message.emailId,
      receivedAt: normalizeDate(message.internalDate).toISOString(),
    });
  }

  if (skippedCount > 0) {
    logWarn("gmail.message.identity.skipped", {
      accountId,
      mailboxId,
      phase: "sort-key",
      skippedCount,
    });
  }

  return keys;
}

function deduplicateSortedKeys(keys: MessageSortKey[]): MessageSortKey[] {
  const seen = new Set<string>();
  return keys.sort(compareSortTuple).filter((key) => {
    if (seen.has(key.id)) {
      return false;
    }
    seen.add(key.id);
    return true;
  });
}

function compareSortTuple(
  first: Pick<MessageSortKey, "receivedAt" | "id">,
  second: Pick<MessageSortKey, "receivedAt" | "id">,
): number {
  return (
    Date.parse(second.receivedAt) - Date.parse(first.receivedAt) ||
    second.id.localeCompare(first.id)
  );
}

async function fetchCurrentPageSummaries(
  client: LiveImapClient,
  accountId: string,
  pageKeys: MessageSortKey[],
  currentMailboxId?: string,
): Promise<LiveMessageSummary[]> {
  const byId = new Map<string, LiveMessageSummary>();
  const keysByMailbox = new Map<string, MessageSortKey[]>();
  for (const key of pageKeys) {
    keysByMailbox.set(key.mailboxId, [...(keysByMailbox.get(key.mailboxId) ?? []), key]);
  }

  for (const [mailboxId, keys] of keysByMailbox) {
    if (mailboxId !== currentMailboxId) {
      await client.mailboxOpen(mailboxId, { readOnly: true });
      currentMailboxId = mailboxId;
    }
    for (const message of await fetchMessageSummariesByUid(
      client,
      accountId,
      keys.map((key) => key.uid),
    )) {
      byId.set(message.id, message);
    }
  }

  const messages = pageKeys.flatMap((key) => {
    const message = byId.get(key.id);
    return message ? [message] : [];
  });
  const skippedCount = pageKeys.length - messages.length;

  if (skippedCount > 0) {
    logWarn("gmail.message.summary.skipped", {
      accountId,
      phase: "current-page",
      skippedCount,
    });
  }

  return messages;
}

async function fetchMessageSummariesByUid(
  client: LiveImapClient,
  accountId: string,
  uids: number[],
): Promise<Array<LiveMessageSummary & { uid: number }>> {
  const messages: Array<LiveMessageSummary & { uid: number }> = [];
  let skippedCount = 0;

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
      if (!message.emailId || message.uid === undefined) {
        skippedCount += 1;
        continue;
      }

      messages.push({
        accountId,
        id: message.emailId,
        ...(message.threadId ? { threadId: message.threadId } : {}),
        subject: message.envelope?.subject ?? "(no subject)",
        sender: participant(message.envelope?.from?.[0]),
        recipients: (message.envelope?.to ?? []).map(participant),
        receivedAt: normalizeDate(message.internalDate).toISOString(),
        unread: !message.flags?.has("\\Seen"),
        starred: message.flags?.has("\\Flagged") === true,
        uid: message.uid,
      });
    }
  }

  if (skippedCount > 0) {
    logWarn("gmail.message.identity.skipped", {
      accountId,
      phase: "summary",
      skippedCount,
    });
  }

  return messages;
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
      cursor.version !== 2 ||
      typeof cursor.accountId !== "string" ||
      (cursor.scope !== "mailbox" && cursor.scope !== "unread") ||
      typeof cursor.mailboxId !== "string" ||
      typeof cursor.uidValidity !== "string" ||
      !Number.isSafeInteger(cursor.upperUid) ||
      (cursor.upperUid ?? 0) <= 0 ||
      typeof cursor.lastReceivedAt !== "string" ||
      Number.isNaN(Date.parse(cursor.lastReceivedAt)) ||
      typeof cursor.lastMessageId !== "string"
    ) {
      throw new Error("Invalid cursor");
    }

    return cursor as LiveMessageCursor;
  } catch {
    throw new Error("Invalid cursor");
  }
}

function compareMessageSummaries(
  first: LiveMessageSummary & { uid: number },
  second: LiveMessageSummary & { uid: number },
): number {
  return compareSortTuple(first, second);
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

async function closeSessionWithoutError(session: ImapClientSession): Promise<void> {
  try {
    await session.close();
  } catch {
    // Logout still clears every other session and the browser App session.
  }
}
