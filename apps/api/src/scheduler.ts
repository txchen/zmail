import type { ConfiguredMailAccount } from "./config.js";
import type { HybridPersistence } from "./persistence.js";
import type { MailboxSyncClient } from "./sync.js";
import { syncMailboxTrees } from "./sync.js";

export type SyncSchedulerOptions = {
  accounts: ConfiguredMailAccount[];
  client: MailboxSyncClient;
  intervalMs: number;
  persistence: HybridPersistence;
};

export type SyncScheduler = {
  pollNow(): Promise<void>;
  refreshAccount(mailAccountId: string): Promise<void>;
  start(): void;
  stop(): void;
};

export function createSyncScheduler({
  accounts,
  client,
  intervalMs,
  persistence,
}: SyncSchedulerOptions): SyncScheduler {
  const activeSyncs = new Map<string, Promise<void>>();
  let timer: ReturnType<typeof setInterval> | undefined;

  async function syncAccount(account: ConfiguredMailAccount): Promise<void> {
    const active = activeSyncs.get(account.id);

    if (active) {
      return active;
    }

    const sync = syncMailboxTrees({
      accounts: [account],
      persistence,
      client,
    })
      .then(() => undefined)
      .finally(() => {
        activeSyncs.delete(account.id);
      });
    activeSyncs.set(account.id, sync);

    return sync;
  }

  return {
    async pollNow() {
      await Promise.all(accounts.map((account) => syncAccount(account)));
    },
    async refreshAccount(mailAccountId) {
      const account = accounts.find((candidate) => candidate.id === mailAccountId);

      if (!account) {
        throw new Error(`Unknown Mail account: ${mailAccountId}`);
      }

      await syncAccount(account);
    },
    start() {
      timer ??= setInterval(() => {
        void this.pollNow();
      }, intervalMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
