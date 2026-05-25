import { describe, expect, it } from "vite-plus/test";
import { createAppWithServices } from "../apps/api/src/app";
import type { ConfiguredMailAccount, SyncConfig } from "../apps/api/src/config";
import { createSyncScheduler } from "../apps/api/src/scheduler";
import { createSyncQueue } from "../apps/api/src/sync-queue";

const accounts: ConfiguredMailAccount[] = [
  { id: "personal", emailAddress: "me@example.com", appPassword: "personal-password" },
  { id: "work", emailAddress: "me@work.example", appPassword: "work-password" },
];

const sync: SyncConfig = {
  recentMessageWindowDays: 90,
  regularSyncIntervalMinutes: 5,
  recentReconciliationIntervalMinutes: 30,
  recentReconciliationWindowDays: 2,
};

describe("Sync scheduler", () => {
  it("can use the same Sync queue exposed by the app factory", async () => {
    const syncQueue = createSyncQueue({ async execute() {} });
    const { app, syncQueue: appSyncQueue } = createAppWithServices({
      appLogin: { username: "reader", password: "secret", sessionSecret: "test-session-secret" },
      storage: { databaseDir: ":memory:" },
      sync,
      mailAccounts: [accounts[0]],
      syncQueue,
    });
    const scheduler = createSyncScheduler({ accounts: [accounts[0]], sync, syncQueue: appSyncQueue });

    scheduler.pollRegularNow();

    expect(app).toBeDefined();
    expect(syncQueue.listJobs()).toMatchObject([
      { accountId: "personal", origin: "automatic", scope: { type: "regular" } },
    ]);
  });

  it("enqueues automatic regular Sync jobs for each Mail account", async () => {
    const syncQueue = createSyncQueue({ async execute() {} });
    const scheduler = createSyncScheduler({ accounts, sync, syncQueue });

    scheduler.pollRegularNow();

    expect(syncQueue.listJobs()).toMatchObject([
      { accountId: "work", origin: "automatic", scope: { type: "regular" } },
      { accountId: "personal", origin: "automatic", scope: { type: "regular" } },
    ]);
  });

  it("enqueues automatic Recent reconciliation jobs on a separate cadence", () => {
    const syncQueue = createSyncQueue({ async execute() {} });
    const scheduler = createSyncScheduler({ accounts: [accounts[0]], sync, syncQueue });

    scheduler.pollRecentReconciliationNow();

    expect(syncQueue.listJobs()).toMatchObject([
      {
        accountId: "personal",
        origin: "automatic",
        scope: { type: "recentReconciliation", days: 2 },
      },
    ]);
  });

  it("uses the Sync queue coalescing rules for automatic work", () => {
    const syncQueue = createSyncQueue({ async execute() {} });
    const scheduler = createSyncScheduler({ accounts: [accounts[0]], sync, syncQueue });

    scheduler.pollRegularNow();
    scheduler.pollRegularNow();

    expect(syncQueue.listJobs()).toHaveLength(1);
  });
});
