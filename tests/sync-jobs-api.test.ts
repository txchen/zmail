import { describe, expect, it } from "vite-plus/test";
import { createApp } from "../apps/api/src/app";
import { createHybridPersistence } from "../apps/api/src/persistence";
import { createSyncQueue } from "../apps/api/src/sync-queue";
import { fetchSyncJobs, scheduleSyncJob } from "../apps/web/src/api";

async function login(app: ReturnType<typeof createApp>) {
  const response = await app.request("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: "reader", password: "secret" }),
    headers: { "content-type": "application/json" },
  });

  return response.headers.get("set-cookie") ?? "";
}

function createTestApp(syncQueue = createSyncQueue({ async execute() {} })) {
  return createApp({
    appLogin: { username: "reader", password: "secret", sessionSecret: "test-session-secret" },
    mailAccounts: [
      { id: "personal", emailAddress: "me@example.com", appPassword: "personal-password" },
    ],
    syncQueue,
  });
}

describe("Sync jobs API", () => {
  it("requires App login authentication to schedule and list Sync jobs", async () => {
    const app = createTestApp();

    const postResponse = await app.request("/api/sync-jobs", {
      method: "POST",
      body: JSON.stringify({ accountId: "personal" }),
      headers: { "content-type": "application/json" },
    });
    const getResponse = await app.request("/api/sync-jobs");

    expect(postResponse.status).toBe(401);
    expect(getResponse.status).toBe(401);
  });

  it("schedules regular Sync jobs and returns accepted job records", async () => {
    const app = createTestApp();
    const cookie = await login(app);

    const response = await app.request("/api/sync-jobs", {
      method: "POST",
      body: JSON.stringify({ accountId: "personal" }),
      headers: { "content-type": "application/json", cookie },
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      job: {
        id: "job-1",
        accountId: "personal",
        origin: "appUser",
        scope: { type: "regular" },
        state: expect.stringMatching(/running|succeeded/),
        createdAt: expect.any(String),
        startedAt: expect.any(String),
      },
    });

    await expect(
      scheduleSyncJob({ accountId: "personal" }, (input, init) =>
        app.request(input, { ...init, headers: { ...init?.headers, cookie } }),
      ),
    ).resolves.toMatchObject({
      job: {
        accountId: "personal",
        origin: "appUser",
        scope: { type: "regular" },
      },
    });
  });

  it("validates Mail accounts and custom range days", async () => {
    const app = createTestApp();
    const cookie = await login(app);

    const unknownAccount = await app.request("/api/sync-jobs", {
      method: "POST",
      body: JSON.stringify({ accountId: "missing" }),
      headers: { "content-type": "application/json", cookie },
    });
    const invalidDays = await app.request("/api/sync-jobs", {
      method: "POST",
      body: JSON.stringify({ accountId: "personal", days: 0 }),
      headers: { "content-type": "application/json", cookie },
    });
    const fractionalDays = await app.request("/api/sync-jobs", {
      method: "POST",
      body: JSON.stringify({ accountId: "personal", days: 1.5 }),
      headers: { "content-type": "application/json", cookie },
    });

    expect(unknownAccount.status).toBe(404);
    expect(invalidDays.status).toBe(400);
    expect(fractionalDays.status).toBe(400);
  });

  it("schedules custom range Sync jobs with validated days", async () => {
    const app = createTestApp();
    const cookie = await login(app);

    const response = await app.request("/api/sync-jobs", {
      method: "POST",
      body: JSON.stringify({ accountId: "personal", days: 3650 }),
      headers: { "content-type": "application/json", cookie },
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      job: {
        accountId: "personal",
        origin: "appUser",
        scope: { type: "customRange", days: 3650 },
      },
    });
  });

  it("lists pending, running, succeeded, and failed jobs with results and errors", async () => {
    const blocker = Promise.withResolvers<void>();
    const syncQueue = createSyncQueue({
      async execute(job) {
        if (job.accountId === "running") {
          await blocker.promise;
        }

        if (job.accountId === "failed") {
          throw new Error("IMAP login failed");
        }

        return { fetchedMessageCount: 2, storedMessageCount: 1 };
      },
    });
    syncQueue.schedule({ accountId: "running", origin: "appUser", scope: { type: "regular" } });
    syncQueue.schedule({ accountId: "pending", origin: "appUser", scope: { type: "regular" } });
    const app = createTestApp(syncQueue);
    const cookie = await login(app);

    let response = await app.request("/api/sync-jobs", { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      jobs: [
        { accountId: "pending", state: "pending" },
        { accountId: "running", state: "running" },
      ],
    });

    blocker.resolve();
    await syncQueue.onIdle();
    syncQueue.schedule({ accountId: "failed", origin: "appUser", scope: { type: "regular" } });
    await syncQueue.onIdle();

    response = await app.request("/api/sync-jobs", { headers: { cookie } });
    expect(await response.json()).toMatchObject({
      jobs: [
        { accountId: "failed", state: "failed", error: "IMAP login failed" },
        {
          accountId: "pending",
          state: "succeeded",
          result: { fetchedMessageCount: 2, storedMessageCount: 1 },
        },
        {
          accountId: "running",
          state: "succeeded",
          result: { fetchedMessageCount: 2, storedMessageCount: 1 },
        },
      ],
    });

    const jobs = await fetchSyncJobs((input, init) =>
      app.request(input, { ...init, headers: { ...init?.headers, cookie } }),
    );
    expect(jobs.jobs).toEqual(
      expect.arrayContaining([expect.objectContaining({ accountId: "failed", state: "failed" })]),
    );
  });

  it("stores regular sync result counts on completed Sync jobs", async () => {
    const persistence = createHybridPersistence();
    persistence.mailDatabaseFor("personal").saveMailbox({
      id: "inbox",
      name: "Inbox",
      unreadCount: 1,
    });
    const app = createApp({
      appLogin: { username: "reader", password: "secret", sessionSecret: "test-session-secret" },
      mailAccounts: [
        { id: "personal", emailAddress: "me@example.com", appPassword: "personal-password" },
      ],
      sync: {
        recentMessageWindowDays: 90,
        regularSyncIntervalMinutes: 5,
        recentReconciliationIntervalMinutes: 30,
        recentReconciliationWindowDays: 2,
      },
      persistence,
      messageSyncClient: {
        async listRecentMessages() {
          return [
            {
              id: "message-1",
              stableIdentity: "gmail:personal:message-1",
              uid: 1,
              subject: "Synced Message",
              receivedAt: "2026-05-24T12:00:00.000Z",
              unread: true,
              readableBody: "<p>Hello</p>",
              attachments: [],
              mailboxIds: ["inbox"],
            },
          ];
        },
      },
    });
    const cookie = await login(app);

    await app.request("/api/sync-jobs", {
      method: "POST",
      body: JSON.stringify({ accountId: "personal" }),
      headers: { "content-type": "application/json", cookie },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const response = await app.request("/api/sync-jobs", { headers: { cookie } });

    expect(await response.json()).toMatchObject({
      jobs: [
        {
          accountId: "personal",
          state: "succeeded",
          result: {
            mailboxCount: 1,
            scannedMailboxCount: 1,
            skippedMailboxCount: 0,
            fetchedMessageCount: 1,
            storedMessageCount: 1,
            removedMailboxEntryCount: 0,
            durationMs: expect.any(Number),
          },
        },
      ],
    });
  });

  it("runs Recent reconciliation jobs and records Account sync status failures", async () => {
    const app = createApp({
      appLogin: { username: "reader", password: "secret", sessionSecret: "test-session-secret" },
      mailAccounts: [
        { id: "personal", emailAddress: "me@example.com", appPassword: "personal-password" },
      ],
      sync: {
        recentMessageWindowDays: 90,
        regularSyncIntervalMinutes: 5,
        recentReconciliationIntervalMinutes: 30,
        recentReconciliationWindowDays: 2,
      },
      messageSyncClient: {
        async listRecentMessages() {
          throw new Error("Gmail unavailable");
        },
      },
    });
    const cookie = await login(app);

    await app.request("/api/sync-jobs", {
      method: "POST",
      body: JSON.stringify({ accountId: "personal", scope: "recentReconciliation" }),
      headers: { "content-type": "application/json", cookie },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const statusResponse = await app.request("/api/mail-accounts/personal/sync-status", {
      headers: { cookie },
    });

    expect(await statusResponse.json()).toMatchObject({
      accountId: "personal",
      syncStatus: "failing",
      lastError: "Gmail unavailable",
    });
  });
});
