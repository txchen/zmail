import { describe, expect, it } from "vite-plus/test";
import { attachmentDownloadUrl, fetchMessage, fetchMessagesForMailbox } from "../apps/web/src/api";
import { renderReadableMessage } from "../apps/web/src/message-rendering";

describe("readable Message rendering", () => {
  it("sanitizes unsafe HTML and blocks remote images by default", () => {
    expect(
      renderReadableMessage({
        accountId: "personal",
        messageId: "message-1",
        readableBody:
          '<p>Hello</p><script>alert("x")</script><img src="https://tracker.example/open.png"><a href="javascript:alert(1)">bad</a>',
        inlineResources: [],
        showRemoteImages: false,
      }),
    ).toMatchObject({
      blockedRemoteImageCount: 1,
    });
    const rendered = renderReadableMessage({
      accountId: "personal",
      messageId: "message-1",
      readableBody:
        '<p>Hello</p><script>alert("x")</script><img src="https://tracker.example/open.png"><a href="javascript:alert(1)">bad</a>',
      inlineResources: [],
      showRemoteImages: false,
    });
    expect(rendered.srcdoc).toContain(
      '<p>Hello</p><img data-remote-src="https://tracker.example/open.png"><a target="_blank" rel="noopener noreferrer">bad</a>',
    );
    expect(rendered.srcdoc).not.toContain("<script>");
  });

  it("escapes plain text when HTML is unavailable and can show remote images manually", () => {
    const rendered = renderReadableMessage({
      accountId: "personal",
      messageId: "message-1",
      readableBody: "",
      plainTextBody: "Hello <reader>\nhttps://example.com/image.png",
      inlineResources: [],
      showRemoteImages: true,
    });

    expect(rendered).toMatchObject({
      blockedRemoteImageCount: 0,
    });
    expect(rendered.srcdoc).toContain("Hello &lt;reader&gt;<br>https://example.com/image.png");
  });

  it("rewrites cid image sources to authenticated inline resource URLs", () => {
    const rendered = renderReadableMessage({
      accountId: "personal",
      messageId: "message-1",
      readableBody: '<img src="cid:image-1@example.com">',
      inlineResources: [{ id: "inline-0", contentId: "image-1@example.com" }],
      showRemoteImages: false,
    });

    expect(rendered.srcdoc).toContain(
      '<img src="/api/mail-accounts/personal/messages/message-1/inline-resources/inline-0">',
    );
  });

  it("builds an encoded Attachment URL used only by the explicit Download control", () => {
    expect(attachmentDownloadUrl("personal account", "gmail/message", "part 4")).toBe(
      "/api/mail-accounts/personal%20account/messages/gmail%2Fmessage/attachments/part%204",
    );
  });

  it("loads Messages for a selected Mailbox and then loads selected Message content", async () => {
    const requests: string[] = [];
    const fetcher = async (path: string | URL | Request): Promise<Response> => {
      requests.push(String(path));

      if (path === "/api/mail-accounts/personal/mailboxes/inbox/messages") {
        return Response.json({
          messages: [
            {
              id: "message-1",
              stableIdentity: "gmail:personal:message-1",
              subject: "Readable Message",
              receivedAt: "2026-05-23T10:00:00.000Z",
              unread: true,
              mailboxEntryId: "message-1:inbox",
              attachments: [],
            },
          ],
        });
      }

      return Response.json({
        message: {
          id: "message-1",
          stableIdentity: "gmail:personal:message-1",
          subject: "Readable Message",
          receivedAt: "2026-05-23T10:00:00.000Z",
          unread: true,
          readableBody: "<p>Hello</p>",
          attachments: [
            {
              id: "attachment-1",
              filename: "agenda.pdf",
              mimeType: "application/pdf",
              sizeBytes: 42,
            },
          ],
        },
      });
    };

    await expect(fetchMessagesForMailbox("personal", "inbox", fetcher)).resolves.toEqual({
      messages: [
        {
          id: "message-1",
          stableIdentity: "gmail:personal:message-1",
          subject: "Readable Message",
          receivedAt: "2026-05-23T10:00:00.000Z",
          unread: true,
          mailboxEntryId: "message-1:inbox",
          attachments: [],
        },
      ],
    });
    await expect(fetchMessage("personal", "message-1", fetcher)).resolves.toEqual({
      message: {
        id: "message-1",
        stableIdentity: "gmail:personal:message-1",
        subject: "Readable Message",
        receivedAt: "2026-05-23T10:00:00.000Z",
        unread: true,
        readableBody: "<p>Hello</p>",
        attachments: [
          {
            id: "attachment-1",
            filename: "agenda.pdf",
            mimeType: "application/pdf",
            sizeBytes: 42,
          },
        ],
      },
    });
    expect(requests).toEqual([
      "/api/mail-accounts/personal/mailboxes/inbox/messages",
      "/api/mail-accounts/personal/messages/message-1",
    ]);
  });

  it("encodes Mailbox IDs with slashes when fetching Message lists", async () => {
    const requests: string[] = [];
    const fetcher = async (path: string | URL | Request): Promise<Response> => {
      requests.push(String(path));

      return Response.json({ messages: [] });
    };

    await fetchMessagesForMailbox("personal", "INBOX/06蓓雯", fetcher);

    expect(requests).toEqual([
      "/api/mail-accounts/personal/mailboxes/INBOX%2F06%E8%93%93%E9%9B%AF/messages",
    ]);
  });
});
