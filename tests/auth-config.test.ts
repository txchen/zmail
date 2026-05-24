import { describe, expect, it } from "vite-plus/test";
import { createApp } from "../apps/api/src/app";
import { loadConfigFromEnv } from "../apps/api/src/config";
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
          displayName: "Personal Gmail",
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
          displayName: "Personal Gmail",
          emailAddress: "me@example.com",
        },
      ],
    });
  });

  it("loads App login and multiple Configured Mail accounts from environment variables", () => {
    const config = loadConfigFromEnv({
      ZMAIL_APP_USERNAME: "reader",
      ZMAIL_APP_PASSWORD: "secret",
      ZMAIL_MAIL_ACCOUNTS: JSON.stringify([
        {
          id: "personal",
          displayName: "Personal Gmail",
          emailAddress: "me@example.com",
          appPassword: "personal-app-password",
        },
        {
          id: "work",
          displayName: "Work Gmail",
          emailAddress: "me@work.example",
          appPassword: "work-app-password",
        },
      ]),
    });

    expect(config).toEqual({
      appLogin: {
        username: "reader",
        password: "secret",
      },
      mailAccounts: [
        {
          id: "personal",
          displayName: "Personal Gmail",
          emailAddress: "me@example.com",
          appPassword: "personal-app-password",
        },
        {
          id: "work",
          displayName: "Work Gmail",
          emailAddress: "me@work.example",
          appPassword: "work-app-password",
        },
      ],
    });
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
            displayName: "Personal Gmail",
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
          displayName: "Personal Gmail",
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
