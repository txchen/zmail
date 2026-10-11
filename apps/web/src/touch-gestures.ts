import { computed, ref } from "vue";

export const pullRefreshThreshold = 64;
const pullRefreshMaxDistance = 96;

export const swipeLeadingWidth = 80;
export const swipeTrailingWidth = 160;
const swipeDirectionSlop = 10;

export type SwipeRest = "closed" | "leading" | "trailing";

/** Damped pull distance for a downward drag that started at the top of the list. */
export function pullDistanceFor(dragY: number): number {
  return dragY <= 0 ? 0 : Math.min(dragY * 0.5, pullRefreshMaxDistance);
}

/** Where a released Message row settles: closed, leading action open, or trailing actions open. */
export function swipeRestFor(offset: number): SwipeRest {
  if (offset <= -swipeTrailingWidth * 0.45) {
    return "trailing";
  }
  if (offset >= swipeLeadingWidth * 0.6) {
    return "leading";
  }
  return "closed";
}

export function swipeOffsetFor(rest: SwipeRest): number {
  if (rest === "leading") {
    return swipeLeadingWidth;
  }
  if (rest === "trailing") {
    return -swipeTrailingWidth;
  }
  return 0;
}

export function usePullToRefresh(options: { enabled(): boolean; refresh(): void }) {
  const distance = ref(0);
  const pulling = ref(false);
  let startY = 0;

  function start(event: TouchEvent) {
    const target = event.currentTarget;
    const touch = event.touches[0];
    pulling.value =
      options.enabled() &&
      event.touches.length === 1 &&
      !!touch &&
      target instanceof HTMLElement &&
      target.scrollTop <= 0;
    startY = touch?.clientY ?? 0;
  }

  function move(event: TouchEvent) {
    const touch = event.touches[0];
    if (pulling.value && touch) {
      distance.value = pullDistanceFor(touch.clientY - startY);
    }
  }

  function end() {
    if (pulling.value && distance.value >= pullRefreshThreshold) {
      options.refresh();
    }
    pulling.value = false;
    distance.value = 0;
  }

  return {
    distance,
    pulling,
    armed: computed(() => distance.value >= pullRefreshThreshold),
    handlers: { touchstart: start, touchmove: move, touchend: end, touchcancel: end },
  };
}

/**
 * Tracks horizontal swipes on Message rows. Only one row is open at a time; vertical drags
 * are left to native scrolling.
 */
export function useSwipeRows(options: { enabled(): boolean }) {
  const openRowId = ref("");
  const openRest = ref<SwipeRest>("closed");
  const dragRowId = ref("");
  const dragOffset = ref(0);
  let startX = 0;
  let startY = 0;
  let baseOffset = 0;
  let direction: "pending" | "horizontal" | "vertical" = "pending";
  let suppressNextClick = false;

  function offsetFor(rowId: string): number {
    if (dragRowId.value === rowId) {
      return dragOffset.value;
    }
    return openRowId.value === rowId ? swipeOffsetFor(openRest.value) : 0;
  }

  function close() {
    openRowId.value = "";
    openRest.value = "closed";
  }

  function start(rowId: string, event: TouchEvent) {
    const touch = event.touches[0];
    if (!options.enabled() || !touch || event.touches.length !== 1) {
      return;
    }
    startX = touch.clientX;
    startY = touch.clientY;
    baseOffset = offsetFor(rowId);
    direction = "pending";
    dragRowId.value = rowId;
    dragOffset.value = baseOffset;
  }

  function move(rowId: string, event: TouchEvent) {
    const touch = event.touches[0];
    if (dragRowId.value !== rowId || !touch || direction === "vertical") {
      return;
    }
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (direction === "pending") {
      if (Math.abs(dx) > swipeDirectionSlop && Math.abs(dx) > Math.abs(dy)) {
        direction = "horizontal";
        if (openRowId.value !== rowId) {
          close();
        }
      } else if (Math.abs(dy) > swipeDirectionSlop) {
        direction = "vertical";
        dragRowId.value = "";
        return;
      } else {
        return;
      }
    }
    dragOffset.value = Math.min(
      Math.max(baseOffset + dx, -swipeTrailingWidth - 24),
      swipeLeadingWidth + 24,
    );
  }

  function end(rowId: string) {
    if (dragRowId.value !== rowId) {
      return;
    }
    if (direction === "horizontal") {
      const rest = swipeRestFor(dragOffset.value);
      openRowId.value = rest === "closed" ? "" : rowId;
      openRest.value = rest;
      suppressNextClick = true;
    } else if (openRowId.value) {
      close();
      suppressNextClick = true;
    }
    dragRowId.value = "";
    dragOffset.value = 0;
  }

  /** Returns true when a row click should be ignored because it ended a swipe. */
  function consumeClick(): boolean {
    const suppressed = suppressNextClick;
    suppressNextClick = false;
    return suppressed;
  }

  return {
    dragRowId,
    offsetFor,
    close,
    consumeClick,
    revealed: (rowId: string) => offsetFor(rowId) !== 0,
    handlers: (rowId: string) => ({
      touchstart: (event: TouchEvent) => start(rowId, event),
      touchmove: (event: TouchEvent) => move(rowId, event),
      touchend: () => end(rowId),
      touchcancel: () => end(rowId),
    }),
  };
}
