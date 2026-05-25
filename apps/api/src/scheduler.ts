import type { ConfiguredMailAccount, SyncConfig } from "./config.js";
import { logInfo } from "./logger.js";
import type { SyncQueue } from "./sync-queue.js";

export type SyncSchedulerOptions = {
  accounts: ConfiguredMailAccount[];
  sync: SyncConfig;
  syncQueue: SyncQueue;
};

export type SyncScheduler = {
  pollRegularNow(): void;
  pollRecentReconciliationNow(): void;
  start(): void;
  stop(): void;
};

export function createSyncScheduler({
  accounts,
  sync,
  syncQueue,
}: SyncSchedulerOptions): SyncScheduler {
  let regularTimer: ReturnType<typeof setInterval> | undefined;
  let recentReconciliationTimer: ReturnType<typeof setInterval> | undefined;

  function scheduleRegular() {
    logInfo("sync.scheduler.poll", {
      scope: "regular",
      accountCount: accounts.length,
      intervalMinutes: sync.regularSyncIntervalMinutes,
    });

    for (const account of accounts) {
      syncQueue.schedule({
        accountId: account.id,
        origin: "automatic",
        scope: { type: "regular" },
      });
    }
  }

  function scheduleRecentReconciliation() {
    logInfo("sync.scheduler.poll", {
      scope: "recentReconciliation",
      accountCount: accounts.length,
      days: sync.recentReconciliationWindowDays,
      intervalMinutes: sync.recentReconciliationIntervalMinutes,
    });

    for (const account of accounts) {
      syncQueue.schedule({
        accountId: account.id,
        origin: "automatic",
        scope: {
          type: "recentReconciliation",
          days: sync.recentReconciliationWindowDays,
        },
      });
    }
  }

  return {
    pollRegularNow: scheduleRegular,
    pollRecentReconciliationNow: scheduleRecentReconciliation,
    start() {
      regularTimer ??= setInterval(scheduleRegular, sync.regularSyncIntervalMinutes * 60 * 1000);
      recentReconciliationTimer ??= setInterval(
        scheduleRecentReconciliation,
        sync.recentReconciliationIntervalMinutes * 60 * 1000,
      );
    },
    stop() {
      if (regularTimer) {
        clearInterval(regularTimer);
        regularTimer = undefined;
      }
      if (recentReconciliationTimer) {
        clearInterval(recentReconciliationTimer);
        recentReconciliationTimer = undefined;
      }
    },
  };
}
