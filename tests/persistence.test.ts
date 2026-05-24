import { describe, expect, it } from "vite-plus/test";
import { createHybridPersistence } from "../apps/api/src/persistence";

describe("hybrid SQLite persistence", () => {
  it("stores app state once and keeps each Mail account in its own mail database", () => {
    const persistence = createHybridPersistence();

    persistence.app.saveMailAccount({
      id: "personal",
      emailAddress: "me@example.com",
      syncStatus: "syncing",
    });
    persistence.app.saveMailAccount({
      id: "work",
      emailAddress: "me@work.example",
      syncStatus: "stale",
    });

    const personal = persistence.mailDatabaseFor("personal");
    const work = persistence.mailDatabaseFor("work");

    personal.saveMailbox({ id: "inbox", name: "Inbox", unreadCount: 1 });
    personal.saveMailbox({ id: "all-mail", name: "All Mail", unreadCount: 1 });
    personal.saveMessage({
      id: "message-1",
      stableIdentity: "gmail:personal:thread-1:message-1",
      subject: "Shared identity",
      receivedAt: "2026-05-23T10:00:00.000Z",
      unread: true,
      starred: false,
      aiProcessed: false,
      readableBody: "<p>Hello</p>",
      attachments: [],
    });
    personal.saveMailboxEntry({
      id: "entry-inbox",
      mailboxId: "inbox",
      messageId: "message-1",
    });
    personal.saveMailboxEntry({
      id: "entry-all-mail",
      mailboxId: "all-mail",
      messageId: "message-1",
    });

    expect(persistence.app.listMailAccounts()).toEqual([
      {
        id: "personal",
        emailAddress: "me@example.com",
        syncStatus: "syncing",
      },
      {
        id: "work",
        emailAddress: "me@work.example",
        syncStatus: "stale",
      },
    ]);
    expect(personal.listMessagesWithMailboxEntries()).toEqual([
      {
        id: "message-1",
        stableIdentity: "gmail:personal:thread-1:message-1",
        subject: "Shared identity",
        receivedAt: "2026-05-23T10:00:00.000Z",
        unread: true,
        starred: false,
        aiProcessed: false,
        readableBody: "<p>Hello</p>",
        attachments: [],
        mailboxEntries: [
          { id: "entry-inbox", mailboxId: "inbox", mailboxName: "Inbox" },
          { id: "entry-all-mail", mailboxId: "all-mail", mailboxName: "All Mail" },
        ],
      },
    ]);
    expect(work.listMessagesWithMailboxEntries()).toEqual([]);
  });
});
