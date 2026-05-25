import { ImapFlow } from "imapflow";
import type { ImapFlowOptions } from "imapflow";
import { simpleParser } from "mailparser";
import { logInfo } from "./logger.js";
import type { MailboxActionClient, MailboxActionTarget } from "./mailbox-actions.js";
import type { ImapMessage, MailboxSyncClient, MessageSyncClient } from "./sync.js";

type ImapFlowClient = {
  connect(): Promise<void>;
  list(options: { statusQuery: { unseen: true; messages?: true; uidNext?: true } }): Promise<
    Array<{
      path: string;
      flags?: Set<string>;
      status?: {
        unseen?: number;
        messages?: number;
        uidNext?: number;
      };
    }>
  >;
  mailboxOpen(path: string): Promise<{ exists?: number }>;
  messageFlagsAdd(
    range: string | number[] | { emailId: string },
    flags: string[],
  ): Promise<boolean>;
  messageFlagsRemove(
    range: string | number[] | { emailId: string },
    flags: string[],
  ): Promise<boolean>;
  messageMove(
    range: string | number[] | { emailId: string },
    destination: string,
  ): Promise<unknown>;
  fetch(
    range: string | { since: Date },
    query: {
      uid: true;
      flags: true;
      envelope: true;
      internalDate: true;
      source: true;
      threadId: true;
    },
    options: { uid: boolean },
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
): MailboxSyncClient & MessageSyncClient & MailboxActionClient {
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
        const mailboxes = await client.list({
          statusQuery: { unseen: true, messages: true, uidNext: true },
        });
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
          totalCount: mailbox.status?.messages,
          uidNext: mailbox.status?.uidNext,
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

        for (const mailbox of mailboxes.filter((candidate) =>
          requestedMailboxes.some((requestedMailbox) => requestedMailbox.id === candidate.path),
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

          const afterUid = requestedMailbox?.afterUid;
          const incremental = afterUid !== undefined;
          const range = incremental
            ? `${afterUid + 1}:*`
            : requestedMailbox?.since
              ? { since: requestedMailbox.since }
              : "1:*";
          logInfo("gmail.messages.mailbox.fetch", {
            accountId: account.id,
            mailboxId: mailbox.path,
            range:
              typeof range === "string" ? range : `since:${requestedMailbox?.since?.toISOString()}`,
            messageCount,
            mode: incremental ? "incremental" : "backfill",
          });
          for await (const message of client.fetch(
            range,
            {
              uid: true,
              flags: true,
              envelope: true,
              internalDate: true,
              source: true,
              threadId: true,
            },
            { uid: incremental },
          )) {
            fetchedMessageCount += 1;
            const id = message.emailId ?? `${mailbox.path}:${message.uid}`;
            const stableIdentity = `gmail:${account.id}:${id}`;
            const existing = messagesByIdentity.get(stableIdentity);
            const starred =
              message.flags?.has("\\Flagged") === true || isStarredMailboxId(mailbox.path);

            if (existing) {
              if (!existing.mailboxIds.includes(mailbox.path)) {
                existing.mailboxIds.push(mailbox.path);
              }
              existing.starred = existing.starred || starred;
              continue;
            }

            const body = await readableBodyFromSource(message.source);
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
              uid: message.uid,
              threadId: message.threadId,
              subject: message.envelope?.subject ?? "(no subject)",
              sender: participantFromAddress(message.envelope?.from?.[0]),
              recipients: message.envelope?.to?.map(participantFromAddress),
              ccRecipients: message.envelope?.cc?.map(participantFromAddress),
              bccRecipients: message.envelope?.bcc?.map(participantFromAddress),
              receivedAt: (receivedAt ?? new Date()).toISOString(),
              unread: !message.flags?.has("\\Seen"),
              starred,
              snippet: body.text.slice(0, 240),
              bodyText: body.text,
              readableBody: body.html,
              plainTextBody: body.text,
              inlineResources: body.inlineResources,
              attachments: body.attachments,
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
    async markRead(target) {
      await applyMessageFlag(target, "\\Seen", true, ImapFlowClient);
    },
    async markUnread(target) {
      await applyMessageFlag(target, "\\Seen", false, ImapFlowClient);
    },
    async star(target) {
      await applyMessageFlag(target, "\\Flagged", true, ImapFlowClient);
    },
    async unstar(target) {
      await applyMessageFlag(target, "\\Flagged", false, ImapFlowClient);
    },
    async archive() {},
    async delete(target) {
      await moveMessageToTrash(target, ImapFlowClient);
    },
  };
}

async function moveMessageToTrash(
  target: MailboxActionTarget,
  ImapFlowClient: ImapFlowConstructor,
): Promise<void> {
  const client = new ImapFlowClient({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: target.emailAddress,
      pass: target.appPassword,
    },
    logger: false,
  });

  await client.connect();

  try {
    for (const mailboxId of mailboxActionCandidates(target).filter(
      (mailboxId) => !isTrashMailboxId(mailboxId),
    )) {
      await client.mailboxOpen(mailboxId);

      const moved = await client.messageMove(
        mailboxActionRange(target, mailboxId),
        "[Gmail]/Trash",
      );

      if (moved) {
        return;
      }
    }

    throw new Error("Gmail message not found");
  } finally {
    await client.logout();
  }
}

async function applyMessageFlag(
  target: MailboxActionTarget,
  flag: "\\Seen" | "\\Flagged",
  enabled: boolean,
  ImapFlowClient: ImapFlowConstructor,
): Promise<void> {
  const client = new ImapFlowClient({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: target.emailAddress,
      pass: target.appPassword,
    },
    logger: false,
  });

  await client.connect();

  try {
    for (const mailboxId of mailboxActionCandidates(target)) {
      await client.mailboxOpen(mailboxId);

      const range = mailboxActionRange(target, mailboxId);
      const changed = enabled
        ? await client.messageFlagsAdd(range, [flag])
        : await client.messageFlagsRemove(range, [flag]);

      if (changed) {
        return;
      }
    }

    throw new Error("Gmail message not found");
  } finally {
    await client.logout();
  }
}

function mailboxActionCandidates(target: MailboxActionTarget): string[] {
  const candidates = target.mailboxIds.length ? target.mailboxIds : ["INBOX"];

  return [...new Set([...candidates, "INBOX"])];
}

function isTrashMailboxId(mailboxId: string): boolean {
  const normalized = mailboxId.toLowerCase();

  return normalized === "trash" || normalized.endsWith("/trash");
}

function mailboxActionRange(
  target: MailboxActionTarget,
  mailboxId: string,
): string | { emailId: string } {
  const uidPrefix = `${mailboxId}:`;

  if (target.messageId.startsWith(uidPrefix)) {
    return target.messageId.slice(uidPrefix.length);
  }

  return { emailId: target.messageId };
}

function isNonSelectableMailbox(mailbox: { flags?: Set<string> }): boolean {
  return mailbox.flags?.has("\\Noselect") === true || mailbox.flags?.has("\\NonExistent") === true;
}

function isStarredMailboxId(mailboxId: string): boolean {
  const normalized = mailboxId.toLowerCase();

  return normalized === "starred" || normalized.endsWith("/starred");
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

async function readableBodyFromSource(source: Buffer | undefined) {
  if (!source) {
    return {
      html: "",
      text: "",
      inlineResources: [],
      attachments: [],
    };
  }

  const parsed = await simpleParser(source);
  const inlineResources = parsed.attachments
    .filter((attachment) => attachment.contentDisposition === "inline" && attachment.cid)
    .map((attachment, index) => ({
      id: `inline-${index}`,
      contentId: normalizeContentId(attachment.cid ?? ""),
      mimeType: attachment.contentType,
      sizeBytes: attachment.size,
      bytes: attachment.content,
    }));
  const attachments = parsed.attachments
    .filter((attachment) => attachment.contentDisposition !== "inline" || !attachment.cid)
    .map((attachment, index) => ({
      id: `attachment-${index}`,
      filename: attachment.filename ?? "attachment",
      mimeType: attachment.contentType,
      sizeBytes: attachment.size,
    }));
  const html = typeof parsed.html === "string" ? parsed.html : "";
  const text = normalizeBodyText(parsed.text || stripHtml(html));

  return {
    html: html || escapeHtml(text).replaceAll("\n", "<br>"),
    text,
    inlineResources,
    attachments,
  };
}

function normalizeContentId(value: string): string {
  return value.trim().replace(/^</, "").replace(/>$/, "");
}

function normalizeBodyText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtml(value: string): string {
  return value
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
