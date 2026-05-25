import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import type {
  MailAccountsResponse,
  MailboxMessagesResponse,
  MailboxTreeResponse,
  MessageResponse,
  SyncJobResponse,
  SyncJobsResponse,
} from "../packages/shared/src";

describe("API documentation", () => {
  it("documents exported shared response type names", () => {
    const docs = readFileSync("docs/api.md", "utf8");
    const exportedTypeNames = [
      "MailAccountsResponse",
      "MailboxTreeResponse",
      "MailboxMessagesResponse",
      "MessageResponse",
      "SyncJobResponse",
      "SyncJobsResponse",
    ] satisfies Array<
      keyof {
        MailAccountsResponse: MailAccountsResponse;
        MailboxTreeResponse: MailboxTreeResponse;
        MailboxMessagesResponse: MailboxMessagesResponse;
        MessageResponse: MessageResponse;
        SyncJobResponse: SyncJobResponse;
        SyncJobsResponse: SyncJobsResponse;
      }
    >;

    for (const typeName of exportedTypeNames) {
      expect(docs).toContain(typeName);
    }
  });
});
