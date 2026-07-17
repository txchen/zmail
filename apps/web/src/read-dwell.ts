export type ReadDwellState = {
  accountId: string;
  messageId: string;
  unread: boolean;
  selected: boolean;
  visible: boolean;
  focused: boolean;
  authenticated: boolean;
  bodyRendered: boolean;
};

export type ReadDwellController = {
  update(state: ReadDwellState): void;
  cancel(): void;
};

export function confirmedRenderedMessageKey(
  renderedMessageKey: string | undefined,
  selectedMessageKey: string,
): string | undefined {
  return renderedMessageKey === selectedMessageKey ? renderedMessageKey : undefined;
}

export function createReadDwellController(options: {
  dwellSeconds: number | (() => number);
  markRead(target: { accountId: string; messageId: string }): Promise<void>;
}): ReadDwellController {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let currentKey = "";
  let cancelledKey = "";
  let completedKey = "";

  function cancelTimer() {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  return {
    update(state) {
      const key = `${state.accountId}:${state.messageId}`;
      if (key !== currentKey) {
        cancelTimer();
        currentKey = key;
        cancelledKey = "";
        completedKey = "";
      }

      const dwellSeconds =
        typeof options.dwellSeconds === "function" ? options.dwellSeconds() : options.dwellSeconds;
      const eligible =
        dwellSeconds > 0 &&
        state.unread &&
        state.selected &&
        state.visible &&
        state.focused &&
        state.authenticated &&
        state.bodyRendered;

      if (!eligible) {
        if (timer !== undefined) {
          cancelTimer();
          cancelledKey = key;
        }
        return;
      }

      if (timer !== undefined || cancelledKey === key || completedKey === key) {
        return;
      }

      timer = setTimeout(() => {
        timer = undefined;
        completedKey = key;
        void options
          .markRead({ accountId: state.accountId, messageId: state.messageId })
          .catch(() => undefined);
      }, dwellSeconds * 1_000);
    },
    cancel() {
      cancelTimer();
      cancelledKey = currentKey;
    },
  };
}
