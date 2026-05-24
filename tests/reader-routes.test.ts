import { describe, expect, it } from "vitest";
import {
  defaultReaderPath,
  mailboxPath,
  messagePath,
  nextMessagePathAfterRemoval,
  parseReaderRoute,
  searchPath,
} from "../apps/web/src/reader-routes";

describe("reader routes", () => {
  it("parses an Account unread view route", () => {
    expect(parseReaderRoute("/accounts/personal/unread", {})).toEqual({
      kind: "unread",
      accountId: "personal",
    });
  });

  it("builds and parses a per-account Search result view route", () => {
    const path = searchPath("personal", "quarterly invoice");

    expect(path).toBe("/accounts/personal/search?q=quarterly%20invoice");
    expect(parseReaderRoute("/accounts/personal/search", { q: "quarterly invoice" })).toEqual({
      kind: "search",
      accountId: "personal",
      query: "quarterly invoice",
    });
  });

  it("builds a Message route inside a Search result view", () => {
    expect(
      messagePath(
        { kind: "search", accountId: "personal", query: "quarterly invoice" },
        "message-1",
        "/",
      ),
    ).toBe("/accounts/personal/search/messages/message-1?q=quarterly%20invoice");
  });

  it("preserves Gmail Mailbox IDs with slashes", () => {
    const path = mailboxPath("personal", "[Gmail]/Trash");

    expect(path).toBe("/accounts/personal/mailboxes/%5BGmail%5D%2FTrash");
    expect(parseReaderRoute(path, {})).toEqual({
      kind: "mailbox",
      accountId: "personal",
      mailboxId: "[Gmail]/Trash",
    });
  });

  it("builds the Default reader view from the first configured Mail account", () => {
    expect(
      defaultReaderPath([
        { id: "personal", emailAddress: "me@example.com" },
        { id: "work", emailAddress: "work@example.com" },
      ]),
    ).toBe("/accounts/personal/unread");
  });

  it("has no Default reader view when there are no Mail accounts", () => {
    expect(defaultReaderPath([])).toBeUndefined();
  });

  it("advances to the next Message after removing the selected Message", () => {
    expect(
      nextMessagePathAfterRemoval(
        { kind: "mailbox", accountId: "personal", mailboxId: "inbox", messageId: "message-1" },
        "message-1",
        [{ id: "message-1" }, { id: "message-2" }],
        "/fallback",
      ),
    ).toBe("/accounts/personal/mailboxes/inbox/messages/message-2");
  });

  it("falls back to the previous Message or current list after removal", () => {
    expect(
      nextMessagePathAfterRemoval(
        { kind: "unread", accountId: "personal", messageId: "message-2" },
        "message-2",
        [{ id: "message-1" }, { id: "message-2" }],
        "/fallback",
      ),
    ).toBe("/accounts/personal/unread/messages/message-1");

    expect(
      nextMessagePathAfterRemoval(
        { kind: "search", accountId: "personal", query: "invoice", messageId: "message-1" },
        "message-1",
        [{ id: "message-1" }],
        "/fallback",
      ),
    ).toBe("/accounts/personal/search?q=invoice");
  });
});
