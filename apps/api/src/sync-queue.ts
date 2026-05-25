export type SyncJobState =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "superseded";

export type SyncJobOrigin = "automatic" | "appUser";

export type SyncScope =
  | { type: "regular" }
  | { type: "recentReconciliation"; days: number }
  | { type: "customRange"; days: number };

export type SyncJobResult = {
  mailboxCount?: number;
  scannedMailboxCount?: number;
  skippedMailboxCount?: number;
  fetchedMessageCount?: number;
  storedMessageCount?: number;
  removedMailboxEntryCount?: number;
  durationMs?: number;
};

export type SyncJobRequest = {
  accountId: string;
  origin: SyncJobOrigin;
  scope: SyncScope;
};

export type SyncJob = SyncJobRequest & {
  id: string;
  state: SyncJobState;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: SyncJobResult;
  error?: string;
};

export type SyncQueueOptions = {
  execute(job: SyncJob): Promise<SyncJobResult | void>;
  now?: () => Date;
  historyLimit?: number;
};

export type SyncQueue = {
  schedule(request: SyncJobRequest): SyncJob;
  listJobs(): SyncJob[];
  getJob(id: string): SyncJob | undefined;
  onIdle(): Promise<void>;
};

export function createSyncQueue({
  execute,
  now = () => new Date(),
  historyLimit = 200,
}: SyncQueueOptions): SyncQueue {
  let nextId = 1;
  const pending: SyncJob[] = [];
  const completed: SyncJob[] = [];
  const inactive: SyncJob[] = [];
  let running: SyncJob | undefined;
  let drainPromise: Promise<void> | undefined;

  function stamp() {
    return now().toISOString();
  }

  function remember(job: SyncJob) {
    completed.unshift(job);
    completed.splice(historyLimit);
  }

  function finishWithoutRunning(job: SyncJob, state: "skipped" | "superseded") {
    job.state = state;
    job.finishedAt = stamp();
    inactive.unshift(job);
  }

  async function drain() {
    if (running) {
      return;
    }

    while (pending.length > 0) {
      const job = pending.shift();
      if (!job) {
        continue;
      }

      running = job;
      job.state = "running";
      job.startedAt = stamp();

      try {
        const result = await execute(job);
        job.state = "succeeded";
        job.result = result ?? {};
      } catch (error) {
        job.state = "failed";
        job.error = error instanceof Error ? error.message : String(error);
      } finally {
        job.finishedAt = stamp();
        running = undefined;
        remember(job);
      }
    }
  }

  function startDrain() {
    if (!drainPromise) {
      drainPromise = drain().finally(() => {
        drainPromise = undefined;
      });
    }
  }

  function hasBlockingCustomRange(accountId: string) {
    return (
      (running?.accountId === accountId && running.scope.type === "customRange") ||
      pending.some((job) => job.accountId === accountId && job.scope.type === "customRange")
    );
  }

  function findDuplicateAutomatic(request: SyncJobRequest) {
    if (request.origin !== "automatic") {
      return undefined;
    }

    const jobs = [...pending];
    if (running) {
      jobs.push(running);
    }

    return jobs.find(
      (job) =>
        job.origin === "automatic" &&
        job.accountId === request.accountId &&
        sameScope(job.scope, request.scope),
    );
  }

  return {
    schedule(request) {
      const duplicate = findDuplicateAutomatic(request);
      if (duplicate) {
        return duplicate;
      }

      const job: SyncJob = {
        ...request,
        id: `job-${nextId}`,
        state: "pending",
        createdAt: stamp(),
      };
      nextId += 1;

      if (request.origin === "automatic" && hasBlockingCustomRange(request.accountId)) {
        finishWithoutRunning(job, "skipped");
        return job;
      }

      if (request.origin === "appUser" && request.scope.type === "customRange") {
        for (let index = pending.length - 1; index >= 0; index -= 1) {
          const pendingJob = pending[index];
          if (
            pendingJob?.origin === "automatic" &&
            pendingJob.accountId === request.accountId &&
            isSmallerCustomRange(pendingJob.scope, request.scope)
          ) {
            pending.splice(index, 1);
            finishWithoutRunning(pendingJob, "superseded");
          }
        }
      }

      pending.push(job);
      startDrain();

      return job;
    },
    listJobs() {
      return [...pending].reverse().concat(running ? [running] : [], completed);
    },
    getJob(id) {
      return running?.id === id
        ? running
        : (pending.find((job) => job.id === id) ??
            completed.find((job) => job.id === id) ??
            inactive.find((job) => job.id === id));
    },
    async onIdle() {
      while (drainPromise) {
        await drainPromise;
      }
    },
  };
}

function sameScope(left: SyncScope, right: SyncScope) {
  if (left.type !== right.type) {
    return false;
  }

  if (left.type === "regular" && right.type === "regular") {
    return true;
  }

  return "days" in left && "days" in right && left.days === right.days;
}

function isSmallerCustomRange(left: SyncScope, right: Extract<SyncScope, { type: "customRange" }>) {
  return left.type === "customRange" && left.days < right.days;
}
