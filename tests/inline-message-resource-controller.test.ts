import { describe, expect, it, vi } from "vite-plus/test";
import { createInlineMessageResourceController } from "../apps/web/src/inline-message-resource-controller";

const message = {
  accountId: "personal",
  id: "message-1",
  inlineResources: [
    {
      id: "logo",
      contentId: "logo@example.com",
      mimeType: "image/png",
      sizeBytes: 3,
    },
    {
      id: "chart",
      contentId: "chart@example.com",
      mimeType: "image/png",
      sizeBytes: 4,
    },
  ],
};

function createPendingInlineMessageResourceHarness() {
  let pendingSignal: AbortSignal | undefined;
  const states: Array<{
    failures: ReadonlyMap<string, { resourceId: string }>;
  }> = [];
  const controller = createInlineMessageResourceController({
    fetchResource: async (_accountId, _messageId, resourceId, signal) => {
      if (resourceId === "logo") {
        throw new Error("Gmail unavailable");
      }
      pendingSignal = signal;
      return new Promise<Blob>(() => {});
    },
    toDataUrl: async () => "data:,",
    onStateChange: (state) => states.push(state),
  });
  return {
    controller,
    states,
    pendingSignal: () => pendingSignal,
  };
}

describe("Inline message resource recovery", () => {
  it("keeps a resource-scoped failure until a Manual retry of only that resource succeeds", async () => {
    const fetchResource = vi.fn(async (resourceId: string) => {
      if (resourceId === "logo" && fetchResource.mock.calls.length === 1) {
        throw new Error("Gmail unavailable");
      }
      return new Blob([resourceId]);
    });
    const states: Array<{
      dataUrls: ReadonlyMap<string, string>;
      failures: ReadonlyMap<string, { resourceId: string }>;
    }> = [];
    const controller = createInlineMessageResourceController({
      fetchResource: (_accountId, _messageId, resourceId) => fetchResource(resourceId),
      toDataUrl: async (blob) => `data:text/plain,${await blob.text()}`,
      onStateChange: (state) => states.push(state),
    });

    await controller.select(message);

    expect(states.at(-1)?.dataUrls.get("chart")).toBe("data:text/plain,chart");
    expect(states.at(-1)?.failures.get("logo")).toEqual({ resourceId: "logo" });
    expect(fetchResource).toHaveBeenCalledTimes(2);

    await controller.retry("logo");

    expect(states.at(-1)?.dataUrls.get("logo")).toBe("data:text/plain,logo");
    expect(states.at(-1)?.dataUrls.get("chart")).toBe("data:text/plain,chart");
    expect(states.at(-1)?.failures.size).toBe(0);
    expect(fetchResource.mock.calls.map(([resourceId]) => resourceId)).toEqual([
      "logo",
      "chart",
      "logo",
    ]);
  });

  it("does not automatically retry after the selected Message state changes", async () => {
    const fetchResource = vi.fn(async () => {
      throw new Error("Gmail unavailable");
    });
    const states: Array<{
      failures: ReadonlyMap<string, { resourceId: string }>;
    }> = [];
    const controller = createInlineMessageResourceController({
      fetchResource,
      toDataUrl: async () => "data:,",
      onStateChange: (state) => states.push(state),
    });
    const oneResourceMessage = { ...message, inlineResources: [message.inlineResources[0]!] };

    await controller.select(oneResourceMessage);
    await controller.select({ ...oneResourceMessage });

    expect(fetchResource).toHaveBeenCalledOnce();
    expect(states.at(-1)?.failures.get("logo")).toEqual({ resourceId: "logo" });
  });

  it("aborts unfinished resources and clears failures when Message selection changes", async () => {
    const { controller, states, pendingSignal } = createPendingInlineMessageResourceHarness();

    void controller.select(message);
    await vi.waitFor(() => expect(states.at(-1)?.failures.has("logo")).toBe(true));
    await controller.select({
      accountId: "personal",
      id: "message-2",
      inlineResources: [],
    });

    expect(pendingSignal()?.aborted).toBe(true);
    expect(states.at(-1)?.failures.size).toBe(0);
  });

  it("aborts unfinished resources and clears failures when logout cancels the page session", async () => {
    const { controller, states, pendingSignal } = createPendingInlineMessageResourceHarness();

    void controller.select(message);
    await vi.waitFor(() => expect(states.at(-1)?.failures.has("logo")).toBe(true));
    controller.cancel();

    expect(pendingSignal()?.aborted).toBe(true);
    expect(states.at(-1)?.failures.size).toBe(0);
  });
});
