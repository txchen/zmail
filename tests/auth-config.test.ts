import { describe, expect, it } from "vite-plus/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/api/src/app";
import { loadConfig, loadConfigFromFile, resolveConfigPath } from "../apps/api/src/config";
import { fetchMailAccounts, fetchSession, login, logout } from "../apps/web/src/api";

describe("App login and configured Mail accounts", () => {
  it("reports missing and invalid startup configuration clearly", () => {
    expect(() => loadConfigFromFile("/missing/zmail.toml")).toThrow(
      "Missing App configuration file at /missing/zmail.toml",
    );
    expect(() =>
      loadConfigFromFile(
        writeConfig(`
          [app_login]
          username = "reader"
          password = "secret"
          session_secret = "test-session-secret"
        `),
      ),
    ).toThrow("Invalid App configuration: missing mail_accounts");
    expect(() =>
      loadConfigFromFile(
        writeConfig(`
          [app_login]
          username = "reader"
          password = "secret"
          session_secret = "test-session-secret"

          [[mail_accounts]]
          id = "Personal"
          email_address = "me@example.com"
          app_password = "personal-app-password"
        `),
      ),
    ).toThrow("Invalid mail_accounts[0].id: expected lowercase slug");
    expect(() =>
      loadConfigFromFile(
        writeConfig(`
          mail_accounts = []

          [app_login]
          username = "reader"
          password = "secret"
          session_secret = "test-session-secret"
          password_hint = "local"
        `),
      ),
    ).toThrow("Invalid app_login: unknown password_hint");
  });

  it("protects configured Mail account summaries behind App login without exposing credentials", async () => {
    const app = createApp({
      appLogin: {
        username: "reader",
        password: "secret",
        sessionSecret: "test-session-secret",
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
      reader: {
        readDwellSeconds: 3,
      },
    });

    const restartedApp = createApp({
      appLogin: {
        username: "reader",
        password: "secret",
        sessionSecret: "test-session-secret",
      },
      mailAccounts: [
        {
          id: "personal",
          emailAddress: "me@example.com",
          appPassword: "gmail-app-password",
        },
      ],
    });

    const restartedSessionResponse = await restartedApp.request("/api/session", {
      headers: { cookie: cookie ?? "" },
    });

    expect(restartedSessionResponse.status).toBe(200);
    expect(await restartedSessionResponse.json()).toEqual({
      authenticated: true,
      username: "reader",
      expiresAt: expect.any(String),
    });
  });

  it("loads App login and multiple Configured Mail accounts from a TOML file", () => {
    const configPath = writeConfig(`
        [app_login]
        username = "reader"
        password = "secret"
        session_secret = "test-session-secret"

        [[mail_accounts]]
        id = "personal"
        email_address = "me@example.com"
        app_password = "personal-app-password"

        [[mail_accounts]]
        id = "work"
        email_address = "me@work.example"
        app_password = "work-app-password"
      `);
    const config = loadConfigFromFile(configPath);

    expect(config).toEqual({
      appLogin: {
        username: "reader",
        password: "secret",
        sessionSecret: "test-session-secret",
        sessionTtlDays: 365,
      },
      reader: {
        readDwellSeconds: 3,
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
    const configPath = writeConfig(`
      mail_accounts = []

      [app_login]
      username = "reader"
      password = "secret"
      session_secret = "test-session-secret"
    `);

    expect(loadConfig({ ZMAIL_CONFIG_PATH: configPath })).toEqual({
      appLogin: {
        username: "reader",
        password: "secret",
        sessionSecret: "test-session-secret",
        sessionTtlDays: 365,
      },
      reader: {
        readDwellSeconds: 3,
      },
      mailAccounts: [],
    });
  });

  it("resolves the default config path from the workspace root when package scripts change cwd", () => {
    expect(resolveConfigPath({}, "apps/api")).toBe(`${process.cwd()}/zmail.toml`);
  });

  it("allows an explicit empty Mail account list", () => {
    const configPath = writeConfig(`
        mail_accounts = []

        [app_login]
        username = "reader"
        password = "secret"
        session_secret = "test-session-secret"
      `);
    const config = loadConfigFromFile(configPath);

    expect(config.mailAccounts).toEqual([]);
    expect(config.reader).toEqual({ readDwellSeconds: 3 });
  });

  it("loads Read dwell time from 0 through 60 seconds and defaults to 3", () => {
    const disabledPath = writeConfig(`
      mail_accounts = []

      [reader]
      read_dwell_seconds = 0

      [app_login]
      username = "reader"
      password = "secret"
      session_secret = "test-session-secret"
    `);
    expect(loadConfigFromFile(disabledPath).reader).toEqual({ readDwellSeconds: 0 });
    const maximumPath = writeConfig(`
      mail_accounts = []

      [reader]
      read_dwell_seconds = 60

      [app_login]
      username = "reader"
      password = "secret"
      session_secret = "test-session-secret"
    `);
    expect(loadConfigFromFile(maximumPath).reader).toEqual({ readDwellSeconds: 60 });

    for (const invalid of [-1, 61, 1.5, "3"]) {
      const value = typeof invalid === "string" ? `"${invalid}"` : invalid;
      const path = writeConfig(`
        mail_accounts = []

        [reader]
        read_dwell_seconds = ${value}

        [app_login]
        username = "reader"
        password = "secret"
        session_secret = "test-session-secret"
      `);
      expect(() => loadConfigFromFile(path)).toThrow(
        "Invalid reader.read_dwell_seconds: expected integer in range 0..60",
      );
    }
  });

  it.each(["storage", "sync"])(
    "rejects obsolete [%s] configuration with a migration error",
    (table) => {
      const configPath = writeConfig(`
        mail_accounts = []

        [${table}]
        obsolete = true

        [app_login]
        username = "reader"
        password = "secret"
        session_secret = "test-session-secret"
      `);

      expect(() => loadConfigFromFile(configPath)).toThrow(
        `Obsolete [${table}] configuration is no longer supported; remove it for Live IMAP access`,
      );
    },
  );

  it("rejects invalid App login credentials without issuing a session", async () => {
    const app = createApp({
      appLogin: {
        username: "reader",
        password: "secret",
        sessionSecret: "test-session-secret",
        sessionTtlDays: 365,
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
        sessionSecret: "test-session-secret",
      },
      mailAccounts: [],
    });

    const response = await app.request("/api/mail-accounts", {
      headers: { cookie: "zmail_session=authenticated" },
    });

    expect(response.status).toBe(401);
  });

  it("reports anonymous sessions and clears App session cookies on logout", async () => {
    const app = createApp({
      appLogin: {
        username: "reader",
        password: "secret",
        sessionSecret: "test-session-secret",
      },
      mailAccounts: [],
    });

    const anonymousSessionResponse = await app.request("/api/session");
    expect(await anonymousSessionResponse.json()).toEqual({ authenticated: false });

    const logoutResponse = await app.request("/api/logout", { method: "POST" });
    expect(logoutResponse.status).toBe(204);
    expect(logoutResponse.headers.get("set-cookie")).toContain("zmail_session=");
    expect(logoutResponse.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("uses a session-only secure cookie in production", async () => {
    const app = createApp({
      appLogin: {
        username: "reader",
        password: "secret",
        sessionSecret: "test-session-secret",
      },
      mailAccounts: [],
      secureCookies: true,
    });

    const response = await app.request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "reader", password: "secret" }),
      headers: { "content-type": "application/json" },
    });
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("Expires=");
    expect(cookie).not.toContain("Max-Age=");
  });

  it("rejects sessions signed with an old secret or an invalid signature", async () => {
    const app = createApp({
      appLogin: {
        username: "reader",
        password: "secret",
        sessionSecret: "original-session-secret",
      },
      mailAccounts: [],
    });
    const loginResponse = await app.request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "reader", password: "secret" }),
      headers: { "content-type": "application/json" },
    });
    const cookie = loginResponse.headers.get("set-cookie") ?? "";

    const rotatedApp = createApp({
      appLogin: {
        username: "reader",
        password: "secret",
        sessionSecret: "rotated-session-secret",
      },
      mailAccounts: [],
    });
    const rotatedSessionResponse = await rotatedApp.request("/api/session", {
      headers: { cookie },
    });
    expect(await rotatedSessionResponse.json()).toEqual({ authenticated: false });

    const invalidSignatureResponse = await app.request("/api/session", {
      headers: { cookie: cookie.replace(/\.[^.;]+/, ".invalid-signature") },
    });
    expect(await invalidSignatureResponse.json()).toEqual({ authenticated: false });
  });

  it("rejects expired App sessions", async () => {
    const app = createApp({
      appLogin: {
        username: "reader",
        password: "secret",
        sessionSecret: "test-session-secret",
        sessionTtlDays: -1,
      },
      mailAccounts: [],
    });
    const loginResponse = await app.request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "reader", password: "secret" }),
      headers: { "content-type": "application/json" },
    });

    const sessionResponse = await app.request("/api/session", {
      headers: { cookie: loginResponse.headers.get("set-cookie") ?? "" },
    });

    expect(await sessionResponse.json()).toEqual({ authenticated: false });
  });

  it("validates App session configuration", () => {
    expect(() =>
      loadConfigFromFile(
        writeConfig(`
          mail_accounts = []

          [app_login]
          username = "reader"
          password = "secret"
        `),
      ),
    ).toThrow("missing app_login.session_secret");

    expect(() =>
      loadConfigFromFile(
        writeConfig(`
          mail_accounts = []

          [app_login]
          username = "reader"
          password = "secret"
          session_secret = "too-short"
        `),
      ),
    ).toThrow("minimum length 16");

    expect(() =>
      loadConfigFromFile(
        writeConfig(`
          mail_accounts = []

          [app_login]
          username = "reader"
          password = "secret"
          session_secret = "test-session-secret"
          session_ttl_days = 3651
        `),
      ),
    ).toThrow("expected integer in range 1..3650");
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

  it("lets the web app check and end an App session", async () => {
    const requests: Array<{ path: string | URL | Request; init: RequestInit | undefined }> = [];
    const fetcher = async (path: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests.push({ path, init });

      if (path === "/api/session") {
        return Response.json({
          authenticated: true,
          username: "reader",
          expiresAt: "2026-05-24T12:00:00.000Z",
        });
      }

      return new Response(null, { status: 204 });
    };

    await expect(fetchSession(fetcher)).resolves.toEqual({
      authenticated: true,
      username: "reader",
      expiresAt: "2026-05-24T12:00:00.000Z",
    });
    await expect(logout(fetcher)).resolves.toBeUndefined();

    expect(requests).toEqual([
      {
        path: "/api/session",
        init: undefined,
      },
      {
        path: "/api/logout",
        init: { method: "POST" },
      },
    ]);
  });

  it("surfaces failed App login to the web app", async () => {
    const fetcher = async (): Promise<Response> =>
      Response.json({ error: "Invalid credentials" }, { status: 401 });

    await expect(login({ username: "reader", password: "wrong" }, fetcher)).rejects.toThrow(
      "Login failed",
    );
  });
});

function writeConfig(contents: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "zmail-config-")), "zmail.toml");
  writeFileSync(path, contents);

  return path;
}
