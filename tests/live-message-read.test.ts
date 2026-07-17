import type { AccountOpenResponse, LiveMessageDetail } from "../packages/shared/src";
import { describe, expect, it, vi } from "vite-plus/test";
import { createApp } from "../apps/api/src/app";
import type { GmailImapReader } from "../apps/api/src/live-imap";

const emptyAccountOpen: AccountOpenResponse = {
  mailAccount: {
    id: "personal",
    emailAddress: "me@example.com",
    unreadCount: 0,
    mailboxes: [],
  },
  inbox: {
    mailboxId: "INBOX",
    messages: [],
  },
};

const message: LiveMessageDetail = {
  accountId: "personal",
  id: "1876543210",
  threadId: "thread-1",
  subject: "Live Message",
  sender: { address: "sender@example.com", displayName: "Sender" },
  recipients: [{ address: "me@example.com" }],
  ccRecipients: [],
  bccRecipients: [],
  receivedAt: "2026-07-17T12:00:00.000Z",
  unread: true,
  starred: false,
  readableBody: '<p>Hello <img src="cid:logo@example.com"></p>',
  plainTextBody: "Hello",
  inlineResources: [
    {
      id: "inline-part",
      contentId: "logo@example.com",
      mimeType: "image/png",
      sizeBytes: 3,
    },
  ],
  attachments: [
    {
      id: "attachment-part",
      filename: "agenda.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
    },
  ],
};

describe("Live Message read API", () => {
  it("reads one Message by account ID and Gmail Message ID without a Mailbox locator", async () => {
    const readMessage = vi.fn(async () => message);
    const reader = testReader({ readMessage });
    const app = createApp(testConfig(reader));
    const cookie = (await login(app)).headers.get("set-cookie") ?? "";

    const response = await app.request("/api/mail-accounts/personal/messages/1876543210", {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message });
    expect(readMessage).toHaveBeenCalledWith(
      {
        id: "personal",
        emailAddress: "me@example.com",
        appPassword: "personal-app-password",
      },
      "1876543210",
    );
  });

  it("serves an Inline message resource through an authenticated non-cacheable response", async () => {
    const resource = {
      mimeType: "image/png",
      bytes: Uint8Array.from([1, 2, 3]),
    };
    const readInlineResource = vi.fn(async () => resource);
    const reader = testReader({ readInlineResource });
    const app = createApp(testConfig(reader));
    const anonymous = await app.request(
      "/api/mail-accounts/personal/messages/1876543210/inline-resources/inline-part",
    );
    const cookie = (await login(app)).headers.get("set-cookie") ?? "";

    const response = await app.request(
      "/api/mail-accounts/personal/messages/1876543210/inline-resources/inline-part",
      { headers: { cookie } },
    );

    expect(anonymous.status).toBe(401);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(resource.bytes);
    expect(readInlineResource).toHaveBeenCalledWith(
      expect.objectContaining({ id: "personal" }),
      "1876543210",
      "inline-part",
    );
  });

  it("streams only an explicitly requested Attachment without response caching", async () => {
    const downloadAttachment = vi.fn(async () => ({
      filename: "agenda.pdf",
      mimeType: "application/pdf",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from([4, 5, 6, 7]));
          controller.close();
        },
      }),
    }));
    const reader = testReader({ downloadAttachment });
    const app = createApp(testConfig(reader));
    const cookie = (await login(app)).headers.get("set-cookie") ?? "";

    const response = await app.request(
      "/api/mail-accounts/personal/messages/1876543210/attachments/attachment-part",
      { headers: { cookie } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="agenda.pdf"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([4, 5, 6, 7]));
    expect(downloadAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ id: "personal" }),
      "1876543210",
      "attachment-part",
    );
  });
});

function testReader(
  overrides: Partial<GmailImapReader> & {
    readMessage?: ReturnType<typeof vi.fn>;
    readInlineResource?: ReturnType<typeof vi.fn>;
    downloadAttachment?: ReturnType<typeof vi.fn>;
  } = {},
): GmailImapReader {
  return {
    openAccount: vi.fn(async () => emptyAccountOpen),
    listMailbox: vi.fn(async () => ({ messages: [] })),
    listUnread: vi.fn(async () => ({ messages: [] })),
    refreshAccount: vi.fn(async () => ({
      mailAccount: emptyAccountOpen.mailAccount,
      view: { kind: "unread", messages: [] },
    })),
    closeAllSessions: vi.fn(async () => undefined),
    ...overrides,
  } as GmailImapReader;
}

function testConfig(gmailImapReader: GmailImapReader) {
  return {
    appLogin: {
      username: "reader",
      password: "secret",
      sessionSecret: "test-session-secret",
    },
    mailAccounts: [
      {
        id: "personal",
        emailAddress: "me@example.com",
        appPassword: "personal-app-password",
      },
    ],
    gmailImapReader,
  };
}

async function login(app: ReturnType<typeof createApp>) {
  return app.request("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: "reader", password: "secret" }),
    headers: { "content-type": "application/json" },
  });
}
