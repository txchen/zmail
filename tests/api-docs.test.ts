import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import type {
  AccountOpenResponse,
  AccountRefreshResponse,
  LiveMessagePage,
  LiveMessageResponse,
  MailAccountsResponse,
  MailboxActionConfirmation,
  SessionResponse,
} from "../packages/shared/src";

describe("API documentation", () => {
  it("documents exported shared response type names", () => {
    const docs = readFileSync("docs/api.md", "utf8");
    const exportedTypeNames = [
      "MailAccountsResponse",
      "SessionResponse",
      "AccountOpenResponse",
      "LiveMessagePage",
      "LiveMessageResponse",
      "AccountRefreshResponse",
      "MailboxActionConfirmation",
    ] satisfies Array<
      keyof {
        MailAccountsResponse: MailAccountsResponse;
        SessionResponse: SessionResponse;
        AccountOpenResponse: AccountOpenResponse;
        LiveMessagePage: LiveMessagePage;
        LiveMessageResponse: LiveMessageResponse;
        AccountRefreshResponse: AccountRefreshResponse;
        MailboxActionConfirmation: MailboxActionConfirmation;
      }
    >;

    for (const typeName of exportedTypeNames) {
      expect(docs).toContain(typeName);
    }
  });
});
