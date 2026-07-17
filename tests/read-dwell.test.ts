import { describe, expect, it, vi } from "vite-plus/test";
import { confirmedRenderedMessageKey, createReadDwellController } from "../apps/web/src/read-dwell";

describe("Read dwell controller", () => {
  it("ignores a cached Message iframe load that arrives after selection changed", () => {
    expect(confirmedRenderedMessageKey("personal:first", "personal:second")).toBeUndefined();
    expect(confirmedRenderedMessageKey("personal:second", "personal:second")).toBe(
      "personal:second",
    );
  });

  it("marks one continuously viewed unread Message read after the configured dwell time", async () => {
    vi.useFakeTimers();
    const markRead = vi.fn(async () => undefined);
    const controller = createReadDwellController({ dwellSeconds: 3, markRead });

    controller.update(viewing("first"));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(markRead).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTicks();

    expect(markRead).toHaveBeenCalledOnce();
    expect(markRead).toHaveBeenCalledWith({ accountId: "personal", messageId: "first" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(markRead).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("disables automatic mark-read when dwell is zero", async () => {
    vi.useFakeTimers();
    const markRead = vi.fn(async () => undefined);
    const controller = createReadDwellController({ dwellSeconds: 0, markRead });

    controller.update(viewing("first"));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(markRead).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("starts only after the unread Message body renders successfully", async () => {
    vi.useFakeTimers();
    const markRead = vi.fn(async () => undefined);
    const controller = createReadDwellController({ dwellSeconds: 3, markRead });

    controller.update({ ...viewing("first"), bodyRendered: false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(markRead).not.toHaveBeenCalled();

    controller.update(viewing("first"));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(markRead).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("submits a completed mark-read once even when Gmail does not confirm it", async () => {
    vi.useFakeTimers();
    const markRead = vi.fn(async () => {
      throw new Error("uncertain");
    });
    const controller = createReadDwellController({ dwellSeconds: 3, markRead });

    controller.update(viewing("first"));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(markRead).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("allows a newly opened unread Message to dwell again after an earlier completion", async () => {
    vi.useFakeTimers();
    const markRead = vi.fn(async () => undefined);
    const controller = createReadDwellController({ dwellSeconds: 3, markRead });

    controller.update(viewing("first"));
    await vi.advanceTimersByTimeAsync(3_000);
    controller.update({ ...viewing("first"), unread: false });
    controller.update({ ...viewing("second"), bodyRendered: false });
    controller.update(viewing("first"));
    await vi.advanceTimersByTimeAsync(3_000);

    expect(markRead).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("waits for a fresh body render when revisiting a cached Message", async () => {
    vi.useFakeTimers();
    const markRead = vi.fn(async () => undefined);
    const controller = createReadDwellController({ dwellSeconds: 3, markRead });

    controller.update(viewing("first"));
    await vi.advanceTimersByTimeAsync(2_000);
    controller.update({ ...viewing("second"), bodyRendered: false });
    controller.update({ ...viewing("first"), bodyRendered: false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(markRead).not.toHaveBeenCalled();

    controller.update(viewing("first"));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(markRead).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it.each([
    ["Message changes", { messageId: "second", bodyRendered: false }, false],
    ["page hides", { visible: false }, true],
    ["window blurs", { focused: false }, true],
    ["logout occurs", { authenticated: false }, true],
    ["body rendering fails", { bodyRendered: false }, true],
  ])("cancels rather than pauses when %s", async (_name, change, restore) => {
    vi.useFakeTimers();
    const markRead = vi.fn(async () => undefined);
    const controller = createReadDwellController({ dwellSeconds: 3, markRead });

    controller.update(viewing("first"));
    await vi.advanceTimersByTimeAsync(2_000);
    controller.update({ ...viewing("first"), ...change });
    if (restore) {
      controller.update(viewing("first"));
    }
    await vi.advanceTimersByTimeAsync(60_000);

    expect(markRead).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

function viewing(messageId: string) {
  return {
    accountId: "personal",
    messageId,
    unread: true,
    selected: true,
    visible: true,
    focused: true,
    authenticated: true,
    bodyRendered: true,
  };
}
