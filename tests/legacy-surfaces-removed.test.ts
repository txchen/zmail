import { describe, expect, it } from "vite-plus/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerApp } from "../apps/api/src/server-app";

describe("removed Local read model server surfaces", () => {
  it.each([
    ["GET", "/ai-api"],
    ["GET", "/ai-api/mail-accounts"],
    ["GET", "/ai-api/messages/unread"],
    ["GET", "/ai-api/messages/gmail%3Apersonal%3Amessage-1"],
    ["GET", "/api/mailbox-tree"],
    ["GET", "/api/sync-jobs"],
    ["POST", "/api/sync-jobs"],
    ["GET", "/api/mail-accounts/personal/sync-status"],
    ["POST", "/api/mail-accounts/personal/diagnose"],
    ["POST", "/api/mail-accounts/personal/messages/actions"],
  ])("does not expose %s %s", async (method, path) => {
    const app = productionApp({
      mailAccounts: [
        {
          id: "personal",
          emailAddress: "me@example.com",
          appPassword: "gmail-app-password",
        },
      ],
    });
    const loginResponse = await app.request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "reader", password: "secret" }),
      headers: { "content-type": "application/json" },
    });

    const response = await app.request(path, {
      method,
      headers: { cookie: loginResponse.headers.get("set-cookie") ?? "" },
    });

    expect(response.status).toBe(404);
  });

  it("returns 404 for unknown production paths instead of the SPA fallback", async () => {
    const app = productionApp({ mailAccounts: [] });

    const response = await app.request("/unknown-server-surface");

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('<div id="app"></div>');
  });

  it.each([
    "/",
    "/accounts/personal/unread",
    "/accounts/personal/unread/messages/message-1",
    "/accounts/personal/mailboxes/INBOX",
    "/accounts/personal/mailboxes/INBOX/messages/message-1",
    "/accounts/personal/search",
    "/accounts/personal/search/messages/message-1",
  ])("serves the supported SPA route %s", async (path) => {
    const app = productionApp({ mailAccounts: [] });

    const response = await app.request(path);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="app"></div>');
  });
});

function productionApp(config: {
  mailAccounts: Array<{ id: string; emailAddress: string; appPassword: string }>;
}) {
  const webDistDir = mkdtempSync(join(tmpdir(), "zmail-web-dist-"));
  writeFileSync(join(webDistDir, "index.html"), '<div id="app"></div>');
  return createServerApp(
    {
      appLogin: {
        username: "reader",
        password: "secret",
        sessionSecret: "test-session-secret",
      },
      ...config,
    },
    { webDistDir, secureCookies: true },
  );
}
