import { afterEach, describe, expect, it, vi } from "vitest";
import { createImapSessionCoordinator } from "../apps/api/src/imap-session-coordinator";

type FakeSession = {
  id: number;
  close: ReturnType<typeof vi.fn<() => Promise<void>>>;
};

afterEach(() => {
  vi.useRealTimers();
});

describe("Live IMAP session coordinator", () => {
  it("reuses one ordinary connection for overlapping operations on one Mail account", async () => {
    const sessions: FakeSession[] = [];
    const coordinator = createImapSessionCoordinator<FakeSession>();
    const connect = vi.fn(async () => {
      const session = { id: sessions.length + 1, close: vi.fn(async () => undefined) };
      sessions.push(session);
      return session;
    });
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = coordinator.run("personal", connect, async (session) => {
      await firstCanFinish;
      return session.id;
    });
    const second = coordinator.run("personal", connect, async (session) => session.id);

    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toEqual([1, 1]);
    expect(connect).toHaveBeenCalledOnce();
  });

  it("serializes ordinary commands for the same Mail account", async () => {
    const coordinator = createImapSessionCoordinator<FakeSession>();
    const connect = async () => ({ id: 1, close: vi.fn(async () => undefined) });
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = coordinator.run("personal", connect, async () => {
      events.push("first:start");
      await firstCanFinish;
      events.push("first:finish");
    });
    const second = coordinator.run("personal", connect, async () => {
      events.push("second:start");
      events.push("second:finish");
    });

    await vi.waitFor(() => expect(events).toEqual(["first:start"]));
    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual(["first:start", "first:finish", "second:start", "second:finish"]);
  });

  it("resets the ten-second Interaction lease after each authorized operation", async () => {
    vi.useFakeTimers();
    const session = { id: 1, close: vi.fn(async () => undefined) };
    const coordinator = createImapSessionCoordinator<FakeSession>();
    const connect = vi.fn(async () => session);

    await coordinator.run("personal", connect, async () => undefined);
    await vi.advanceTimersByTimeAsync(9_000);
    await coordinator.run("personal", connect, async () => undefined);
    await vi.advanceTimersByTimeAsync(9_000);

    expect(session.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.close).toHaveBeenCalledOnce();
  });

  it("closes an expired session and opens a new one for the next operation", async () => {
    vi.useFakeTimers();
    const sessions: FakeSession[] = [];
    const coordinator = createImapSessionCoordinator<FakeSession>();
    const connect = vi.fn(async () => {
      const session = { id: sessions.length + 1, close: vi.fn(async () => undefined) };
      sessions.push(session);
      return session;
    });

    await expect(coordinator.run("personal", connect, async (session) => session.id)).resolves.toBe(
      1,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(coordinator.run("personal", connect, async (session) => session.id)).resolves.toBe(
      2,
    );

    expect(sessions[0]?.close).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("closes and discards a session after an operation failure", async () => {
    const sessions: FakeSession[] = [];
    const coordinator = createImapSessionCoordinator<FakeSession>();
    const connect = vi.fn(async () => {
      const session = { id: sessions.length + 1, close: vi.fn(async () => undefined) };
      sessions.push(session);
      return session;
    });

    await expect(
      coordinator.run("personal", connect, async () => {
        throw new Error("connection broke");
      }),
    ).rejects.toThrow("connection broke");
    await expect(coordinator.run("personal", connect, async (session) => session.id)).resolves.toBe(
      2,
    );

    expect(sessions[0]?.close).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("closes one account without closing another account's session", async () => {
    const sessions = new Map<string, FakeSession>();
    const coordinator = createImapSessionCoordinator<FakeSession>();
    const connect = (accountId: string) => async () => {
      const session = { id: sessions.size + 1, close: vi.fn(async () => undefined) };
      sessions.set(accountId, session);
      return session;
    };

    await coordinator.run("personal", connect("personal"), async () => undefined);
    await coordinator.run("work", connect("work"), async () => undefined);
    await coordinator.closeAccount("personal");

    expect(sessions.get("personal")?.close).toHaveBeenCalledOnce();
    expect(sessions.get("work")?.close).not.toHaveBeenCalled();
  });

  it("closes every active account session", async () => {
    const sessions: FakeSession[] = [];
    const coordinator = createImapSessionCoordinator<FakeSession>();
    const connect = async () => {
      const session = { id: sessions.length + 1, close: vi.fn(async () => undefined) };
      sessions.push(session);
      return session;
    };

    await coordinator.run("personal", connect, async () => undefined);
    await coordinator.run("work", connect, async () => undefined);
    await coordinator.closeAll();

    expect(sessions.map((session) => session.close.mock.calls.length)).toEqual([1, 1]);
  });

  it("does not start a new operation while all sessions are closing", async () => {
    const coordinator = createImapSessionCoordinator<FakeSession>();
    let releaseOperation!: () => void;
    const operationCanFinish = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    const connect = async () => ({ id: 1, close: vi.fn(async () => undefined) });
    const operation = coordinator.run("personal", connect, async () => operationCanFinish);
    await Promise.resolve();

    const closeAll = coordinator.closeAll();
    await expect(coordinator.run("personal", connect, async () => undefined)).rejects.toThrow(
      "IMAP sessions are closing",
    );

    releaseOperation();
    await operation;
    await closeAll;
  });
});
