import { describe, expect, it } from "vite-plus/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/api/src/app";
import { loadConfig, loadConfigFromFile, resolveConfigPath } from "../apps/api/src/config";
import { fetchMailAccounts, login } from "../apps/web/src/api";

describe("App login and configured Mail accounts", () => {
  it("protects configured Mail account summaries behind App login without exposing credentials", async () => {
    const app = createApp({
      appLogin: {
        username: "reader",
        password: "secret",
      },
      mailAccounts: [
        {
          id: "personal",
          emailAddress: "me@example.com",
          appPassword: "gmail-app-password",
        },
      ],
    });

    const anonymousResponse = await app.request("/api/mail-accounts");
    expect(anonymousResponse.status).toBe(401);

    const loginResponse = await app.request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "reader", password: "secret" }),
      headers: { "content-type": "application/json" },
    });
    expect(loginResponse.status).toBe(204);

    const cookie = loginResponse.headers.get("set-cookie");
    expect(cookie).toContain("zmail_session=");

    const accountsResponse = await app.request("/api/mail-accounts", {
      headers: { cookie: cookie ?? "" },
    });

    expect(accountsResponse.status).toBe(200);
    expect(await accountsResponse.json()).toEqual({
      mailAccounts: [
        {
          id: "personal",
          emailAddress: "me@example.com",
        },
      ],
    });
  });

  it("loads App login and multiple Configured Mail accounts from a TOML file", () => {
    const config = loadConfigFromFile(
      writeConfig(`
        [app_login]
        username = "reader"
        password = "secret"

        [[mail_accounts]]
        id = "personal"
        email_address = "me@example.com"
        app_password = "personal-app-password"

        [[mail_accounts]]
        id = "work"
        email_address = "me@work.example"
        app_password = "work-app-password"
      `),
    );

    expect(config).toEqual({
      appLogin: {
        username: "reader",
        password: "secret",
      },
      mailAccounts: [
        {
          id: "personal",
          emailAddress: "me@example.com",
          appPassword: "personal-app-password",
        },
        {
          id: "work",
          emailAddress: "me@work.example",
          appPassword: "work-app-password",
        },
      ],
    });
  });

  it("loads the config path selected by ZMAIL_CONFIG_PATH", () => {
    const path = writeConfig(`
      mail_accounts = []

      [app_login]
      username = "reader"
      password = "secret"
    `);

    expect(loadConfig({ ZMAIL_CONFIG_PATH: path })).toEqual({
      appLogin: {
        username: "reader",
        password: "secret",
      },
      mailAccounts: [],
    });
  });

  it("resolves the default config path from the workspace root when package scripts change cwd", () => {
    expect(resolveConfigPath({}, "apps/api")).toBe(`${process.cwd()}/zmail.toml`);
  });

  it("allows an explicit empty Mail account list", () => {
    const config = loadConfigFromFile(
      writeConfig(`
        mail_accounts = []

        [app_login]
        username = "reader"
        password = "secret"
      `),
    );

    expect(config.mailAccounts).toEqual([]);
  });

  it("rejects invalid App login credentials without issuing a session", async () => {
    const app = createApp({
      appLogin: {
        username: "reader",
        password: "secret",
      },
      mailAccounts: [],
    });

    const response = await app.request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "reader", password: "wrong" }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not accept a guessed session cookie", async () => {
    const app = createApp({
      appLogin: {
        username: "reader",
        password: "secret",
      },
      mailAccounts: [],
    });

    const response = await app.request("/api/mail-accounts", {
      headers: { cookie: "zmail_session=authenticated" },
    });

    expect(response.status).toBe(401);
  });

  it("lets the web app login and fetch protected Mail account summaries", async () => {
    const requests: Array<{ path: string | URL | Request; init: RequestInit | undefined }> = [];
    const fetcher = async (path: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests.push({ path, init });

      if (path === "/api/login") {
        return new Response(null, { status: 204 });
      }

      return Response.json({
        mailAccounts: [
          {
            id: "personal",
            emailAddress: "me@example.com",
          },
        ],
      });
    };

    await login({ username: "reader", password: "secret" }, fetcher);
    await expect(fetchMailAccounts(fetcher)).resolves.toEqual({
      mailAccounts: [
        {
          id: "personal",
          emailAddress: "me@example.com",
        },
      ],
    });

    expect(requests).toEqual([
      {
        path: "/api/login",
        init: {
          method: "POST",
          body: JSON.stringify({ username: "reader", password: "secret" }),
          headers: { "content-type": "application/json" },
        },
      },
      {
        path: "/api/mail-accounts",
        init: undefined,
      },
    ]);
  });
});

function writeConfig(contents: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "zmail-config-")), "zmail.toml");
  writeFileSync(path, contents);

  return path;
}
