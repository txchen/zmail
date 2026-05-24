import { describe, expect, it } from "vite-plus/test";
import { createApp } from "../apps/api/src/app";
import type { ConfiguredMailAccount } from "../apps/api/src/config";
import { createHybridPersistence } from "../apps/api/src/persistence";

describe("read-only AI API", () => {
  it("lists Mail accounts and Gmail-unread Messages with stable identities without mutating unread state", async () => {
    const { app, persistence } = createAiApiFixture();

    const accountsResponse = await app.request("/ai-api/mail-accounts");
    expect(accountsResponse.status).toBe(200);
    expect(await accountsResponse.json()).toEqual({
      mailAccounts: [
        {
          id: "personal",
          emailAddress: "me@example.com",
          syncStatus: "stale",
        },
      ],
    });

    const unreadResponse = await app.request("/ai-api/messages/unread");
    expect(unreadResponse.status).toBe(200);
    expect(await unreadResponse.json()).toEqual({
      messages: [
        {
          accountId: "personal",
          id: "message-1",
          stableIdentity: "gmail:personal:message-1",
          subject: "Unread Message",
          sender: { address: "" },
          recipients: [],
          ccRecipients: [],
          bccRecipients: [],
          receivedAt: "2026-05-23T10:00:00.000Z",
          unread: true,
          starred: false,
          mailboxIds: [],
          snippet: "",
          attachmentCount: 0,
          updatedAt: "2026-05-23T10:00:00.000Z",
        },
      ],
    });

    const messageResponse = await app.request("/ai-api/messages/gmail%3Apersonal%3Amessage-1");
    expect(messageResponse.status).toBe(200);
    expect(await messageResponse.json()).toEqual({
      message: {
        accountId: "personal",
        id: "message-1",
        stableIdentity: "gmail:personal:message-1",
        subject: "Unread Message",
        sender: { address: "" },
        recipients: [],
        ccRecipients: [],
        bccRecipients: [],
        receivedAt: "2026-05-23T10:00:00.000Z",
        unread: true,
        starred: false,
        mailboxIds: [],
        snippet: "",
        attachmentCount: 0,
        updatedAt: "2026-05-23T10:00:00.000Z",
        readableBody: "<p>Hello AI reader</p>",
        blockedRemoteImageCount: 0,
        inlineResources: [],
        attachments: [],
      },
    });
    expect(persistence.mailDatabaseFor("personal").getMessage("message-1")).toMatchObject({
      unread: true,
    });
  });

  it("does not expose Mailbox actions on the AI API", async () => {
    const { app } = createAiApiFixture();

    const response = await app.request("/ai-api/messages/gmail%3Apersonal%3Amessage-1/actions", {
      method: "POST",
      body: JSON.stringify({ action: "markRead" }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(404);
  });
});

function createAiApiFixture() {
  const account: ConfiguredMailAccount = {
    id: "personal",
    emailAddress: "me@example.com",
    appPassword: "personal-app-password",
  };
  const persistence = createHybridPersistence();
  const mailDatabase = persistence.mailDatabaseFor("personal");

  mailDatabase.saveMessage({
    id: "message-1",
    stableIdentity: "gmail:personal:message-1",
    subject: "Unread Message",
    receivedAt: "2026-05-23T10:00:00.000Z",
    unread: true,
    starred: false,
    aiProcessed: false,
    readableBody: "<p>Hello AI reader</p>",
    attachments: [],
  });
  mailDatabase.saveMessage({
    id: "message-2",
    stableIdentity: "gmail:personal:message-2",
    subject: "Read Message",
    receivedAt: "2026-05-22T10:00:00.000Z",
    unread: false,
    starred: false,
    aiProcessed: false,
    readableBody: "<p>Already read</p>",
    attachments: [],
  });

  return {
    app: createApp({
      appLogin: { username: "reader", password: "secret", sessionSecret: "test-session-secret" },
      mailAccounts: [account],
      persistence,
    }),
    persistence,
  };
}
