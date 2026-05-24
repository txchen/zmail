import { describe, expect, it } from "vite-plus/test";
import { fetchMessage, fetchMessagesForMailbox } from "../apps/web/src/api";
import { renderReadableMessage } from "../apps/web/src/message-rendering";

describe("readable Message rendering", () => {
  it("sanitizes unsafe HTML and blocks remote images by default", () => {
    expect(
      renderReadableMessage({
        readableBody:
          '<p>Hello</p><script>alert("x")</script><img src="https://tracker.example/open.png"><a href="javascript:alert(1)">bad</a>',
        showRemoteImages: false,
      }),
    ).toEqual({
      html: '<p>Hello</p><img data-remote-src="https://tracker.example/open.png"><a>bad</a>',
      blockedRemoteImageCount: 1,
    });
  });

  it("escapes plain text when HTML is unavailable and can show remote images manually", () => {
    expect(
      renderReadableMessage({
        readableBody: "",
        plainTextBody: "Hello <reader>\nhttps://example.com/image.png",
        showRemoteImages: true,
      }),
    ).toEqual({
      html: "Hello &lt;reader&gt;<br>https://example.com/image.png",
      blockedRemoteImageCount: 0,
    });
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
});
