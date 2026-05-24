import { describe, expect, it } from "vite-plus/test";
import { createHybridPersistence } from "../apps/api/src/persistence";

describe("hybrid SQLite persistence", () => {
  it("stores app state once and keeps each Mail account in its own mail database", () => {
    const persistence = createHybridPersistence();

    persistence.app.saveMailAccount({
      id: "personal",
      displayName: "Personal Gmail",
      emailAddress: "me@example.com",
      syncStatus: "syncing",
    });
    persistence.app.saveMailAccount({
      id: "work",
      displayName: "Work Gmail",
      emailAddress: "me@work.example",
      syncStatus: "stale",
    });

    const personal = persistence.mailDatabaseFor("personal");
    const work = persistence.mailDatabaseFor("work");

    personal.saveMailbox({ id: "inbox", name: "Inbox" });
    personal.saveMailbox({ id: "all-mail", name: "All Mail" });
    personal.saveMessage({
      id: "message-1",
      stableIdentity: "gmail:personal:thread-1:message-1",
      subject: "Shared identity",
      unread: true,
      aiProcessed: false,
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
        displayName: "Personal Gmail",
        emailAddress: "me@example.com",
        syncStatus: "syncing",
      },
      {
        id: "work",
        displayName: "Work Gmail",
        emailAddress: "me@work.example",
        syncStatus: "stale",
      },
    ]);
    expect(personal.listMessagesWithMailboxEntries()).toEqual([
      {
        id: "message-1",
        stableIdentity: "gmail:personal:thread-1:message-1",
        subject: "Shared identity",
        unread: true,
        aiProcessed: false,
        mailboxEntries: [
          { id: "entry-inbox", mailboxId: "inbox", mailboxName: "Inbox" },
          { id: "entry-all-mail", mailboxId: "all-mail", mailboxName: "All Mail" },
        ],
      },
    ]);
    expect(work.listMessagesWithMailboxEntries()).toEqual([]);
  });
});
