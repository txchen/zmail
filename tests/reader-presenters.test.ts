import { describe, expect, it } from "vitest";
import { accountSyncStatusLabel } from "../apps/web/src/reader-presenters";

describe("reader presenters", () => {
  it("formats Account sync status for the Account mailbox tree", () => {
    expect(accountSyncStatusLabel("synced")).toBe("Synced");
    expect(accountSyncStatusLabel("syncing")).toBe("Syncing");
    expect(accountSyncStatusLabel("stale")).toBe("Stale");
    expect(accountSyncStatusLabel("failing")).toBe("Failing");
  });
});
