import { describe, expect, it } from "vitest";
import {
  defaultReaderPath,
  mailboxPath,
  messagePath,
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
});
