import type { InlineMessageResourceMetadata } from "@zmail/shared";

export type InlineMessageResourceMessage = {
  accountId: string;
  id: string;
  inlineResources: InlineMessageResourceMetadata[];
};

export type InlineMessageResourceState = {
  dataUrls: ReadonlyMap<string, string>;
  failures: ReadonlyMap<string, { resourceId: string }>;
};

export function createInlineMessageResourceController(options: {
  fetchResource(
    accountId: string,
    messageId: string,
    resourceId: string,
    signal: AbortSignal,
  ): Promise<Blob>;
  toDataUrl(blob: Blob): Promise<string>;
  onStateChange(state: InlineMessageResourceState): void;
}) {
  let selectedMessage: InlineMessageResourceMessage | null = null;
  let selectedMessageKey = "";
  let selectionGeneration = 0;
  const activeLoads = new Map<string, AbortController>();
  let dataUrls = new Map<string, string>();
  let failures = new Map<string, { resourceId: string }>();

  function publish() {
    options.onStateChange({
      dataUrls: new Map(dataUrls),
      failures: new Map(failures),
    });
  }

  async function load(resourceId: string, expectedSelectionGeneration: number): Promise<void> {
    if (!selectedMessage) {
      return;
    }

    const message = selectedMessage;
    const controller = new AbortController();
    activeLoads.set(resourceId, controller);
    try {
      const blob = await options.fetchResource(
        message.accountId,
        message.id,
        resourceId,
        controller.signal,
      );
      const dataUrl = await options.toDataUrl(blob);
      if (
        selectionGeneration !== expectedSelectionGeneration ||
        activeLoads.get(resourceId) !== controller
      ) {
        return;
      }
      dataUrls.set(resourceId, dataUrl);
      failures.delete(resourceId);
      publish();
    } catch (error) {
      if (
        selectionGeneration !== expectedSelectionGeneration ||
        activeLoads.get(resourceId) !== controller ||
        isAbortError(error)
      ) {
        return;
      }
      failures.set(resourceId, { resourceId });
      publish();
    } finally {
      if (activeLoads.get(resourceId) === controller) {
        activeLoads.delete(resourceId);
      }
    }
  }

  function cancel() {
    selectionGeneration += 1;
    for (const controller of activeLoads.values()) {
      controller.abort();
    }
    activeLoads.clear();
    selectedMessage = null;
    selectedMessageKey = "";
    dataUrls = new Map();
    failures = new Map();
    publish();
  }

  return {
    async select(message: InlineMessageResourceMessage | null): Promise<void> {
      const messageKey = message ? `${message.accountId}:${message.id}` : "";
      if (messageKey === selectedMessageKey) {
        return;
      }
      cancel();
      selectedMessage = message;
      selectedMessageKey = messageKey;
      if (!message) {
        return;
      }
      const expectedSelectionGeneration = selectionGeneration;
      await Promise.all(
        message.inlineResources.map((resource) => load(resource.id, expectedSelectionGeneration)),
      );
    },
    async retry(resourceId: string): Promise<void> {
      if (!selectedMessage || !failures.has(resourceId)) {
        return;
      }
      await load(resourceId, selectionGeneration);
    },
    cancel,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
