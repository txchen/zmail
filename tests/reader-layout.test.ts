import { describe, expect, it } from "vite-plus/test";
import { readSavedReaderLayout, saveReaderLayout } from "../apps/web/src/reader-layout";

describe("reader layout persistence", () => {
  it("migrates persisted Mailbox state to a payload containing layout widths only", () => {
    let payload = JSON.stringify({
      navColumnWidth: 240,
      listColumnWidth: 420,
      accountId: "personal",
      mailboxId: "INBOX",
      collapsedAccounts: ["personal"],
      collapsedMailboxGroups: ["personal:Projects"],
    });
    const storage = {
      getItem: () => payload,
      setItem: (_key: string, value: string) => {
        payload = value;
      },
    };

    const layout = readSavedReaderLayout(storage);
    saveReaderLayout(layout.navColumnWidth, layout.listColumnWidth, storage);

    expect(JSON.parse(payload)).toEqual({
      navColumnWidth: 240,
      listColumnWidth: 420,
    });
    expect(payload).not.toMatch(/personal|INBOX|accountId|mailboxId|collapsed/);
  });
});
