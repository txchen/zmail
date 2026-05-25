import { describe, expect, it } from "vite-plus/test";
import { createSyncQueue, type SyncJobRequest } from "../apps/api/src/sync-queue";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

const automaticRegular = (accountId: string): SyncJobRequest => ({
  accountId,
  origin: "automatic",
  scope: { type: "regular" },
});

describe("Sync queue", () => {
  it("runs scheduled Sync jobs one at a time in queue order", async () => {
    const first = deferred();
    const started: string[] = [];
    const finished: string[] = [];
    const queue = createSyncQueue({
      async execute(job) {
        started.push(job.accountId);

        if (job.accountId === "personal") {
          await first.promise;
        }

        finished.push(job.accountId);
        return { fetchedMessageCount: job.accountId === "personal" ? 1 : 2 };
      },
    });

    const personal = queue.schedule(automaticRegular("personal"));
    const work = queue.schedule(automaticRegular("work"));

    expect(personal.state).toBe("running");
    expect(work.state).toBe("pending");
    expect(started).toEqual(["personal"]);

    first.resolve();
    await queue.onIdle();

    expect(started).toEqual(["personal", "work"]);
    expect(finished).toEqual(["personal", "work"]);
    expect(queue.listJobs()).toMatchObject([
      { id: work.id, accountId: "work", state: "succeeded", result: { fetchedMessageCount: 2 } },
      {
        id: personal.id,
        accountId: "personal",
        state: "succeeded",
        result: { fetchedMessageCount: 1 },
      },
    ]);
  });

  it("coalesces duplicate automatic work for the same Mail account and Sync scope", () => {
    const queue = createSyncQueue({
      async execute() {
        return {};
      },
    });

    const first = queue.schedule(automaticRegular("personal"));
    const duplicate = queue.schedule(automaticRegular("personal"));
    const otherAccount = queue.schedule(automaticRegular("work"));

    expect(duplicate.id).toBe(first.id);
    expect(queue.listJobs().map((job) => job.id)).toEqual([otherAccount.id, first.id]);
  });

  it("lets wider App user custom range jobs supersede pending smaller automatic jobs", () => {
    const blocker = deferred();
    const queue = createSyncQueue({
      async execute(job) {
        if (job.accountId === "blocker") {
          await blocker.promise;
        }

        return {};
      },
    });

    queue.schedule(automaticRegular("blocker"));
    const automaticCustom = queue.schedule({
      accountId: "personal",
      origin: "automatic",
      scope: { type: "customRange", days: 7 },
    });
    const appUserCustom = queue.schedule({
      accountId: "personal",
      origin: "appUser",
      scope: { type: "customRange", days: 30 },
    });

    expect(queue.listJobs().map((job) => job.id)).toEqual([appUserCustom.id, "job-1"]);
    expect(queue.getJob(automaticCustom.id)?.state).toBe("superseded");

    blocker.resolve();
  });

  it("skips automatic work while a custom range job is pending or running for the same Mail account", () => {
    const blocker = deferred();
    const queue = createSyncQueue({
      async execute(job) {
        if (job.scope.type === "customRange") {
          await blocker.promise;
        }

        return {};
      },
    });

    const customRange = queue.schedule({
      accountId: "personal",
      origin: "appUser",
      scope: { type: "customRange", days: 30 },
    });
    const skipped = queue.schedule(automaticRegular("personal"));
    const otherAccount = queue.schedule(automaticRegular("work"));

    expect(skipped.state).toBe("skipped");
    expect(queue.listJobs().map((job) => job.id)).toEqual([otherAccount.id, customRange.id]);

    blocker.resolve();
  });

  it("captures failures without stopping later jobs", async () => {
    const queue = createSyncQueue({
      async execute(job) {
        if (job.accountId === "personal") {
          throw new Error("IMAP login failed");
        }

        return { fetchedMessageCount: 2 };
      },
    });

    queue.schedule(automaticRegular("personal"));
    queue.schedule(automaticRegular("work"));
    await queue.onIdle();

    expect(queue.listJobs()).toMatchObject([
      { accountId: "work", state: "succeeded", result: { fetchedMessageCount: 2 } },
      { accountId: "personal", state: "failed", error: "IMAP login failed" },
    ]);
  });

  it("retains only the last 200 completed jobs in memory", async () => {
    const queue = createSyncQueue({
      async execute() {
        return {};
      },
    });

    for (let index = 0; index < 205; index += 1) {
      queue.schedule({
        accountId: `account-${index}`,
        origin: "appUser",
        scope: { type: "regular" },
      });
    }
    await queue.onIdle();

    const jobs = queue.listJobs();
    expect(jobs).toHaveLength(200);
    expect(jobs.at(-1)?.id).toBe("job-6");
    expect(queue.getJob("job-1")).toBeUndefined();
  });
});
