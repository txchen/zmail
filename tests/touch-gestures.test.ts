import { describe, expect, it } from "vite-plus/test";
import {
  pullDistanceFor,
  pullRefreshThreshold,
  swipeOffsetFor,
  swipeRestFor,
  swipeTrailingWidth,
  swipeLeadingWidth,
} from "../apps/web/src/touch-gestures";

describe("touch gestures", () => {
  it("damps and caps pull-to-refresh distance and ignores upward drags", () => {
    expect(pullDistanceFor(-40)).toBe(0);
    expect(pullDistanceFor(2 * pullRefreshThreshold)).toBe(pullRefreshThreshold);
    expect(pullDistanceFor(1000)).toBe(96);
  });

  it("settles a short swipe closed and a long swipe open on the swiped side", () => {
    expect(swipeRestFor(-20)).toBe("closed");
    expect(swipeRestFor(20)).toBe("closed");
    expect(swipeRestFor(-swipeTrailingWidth)).toBe("trailing");
    expect(swipeRestFor(swipeLeadingWidth)).toBe("leading");
  });

  it("opens each side exactly wide enough for its actions", () => {
    expect(swipeOffsetFor("closed")).toBe(0);
    expect(swipeOffsetFor("leading")).toBe(swipeLeadingWidth);
    expect(swipeOffsetFor("trailing")).toBe(-swipeTrailingWidth);
  });
});
