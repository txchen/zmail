const minimumMessageZoom = 0.5;

/**
 * Sizes a same-origin Message body frame to its content so the reader scrolls once, and shrinks
 * wide fixed-layout HTML to the frame width the way native mail clients do.
 */
export function fitMessageFrame(frame: HTMLIFrameElement): void {
  const root = frame.contentDocument?.documentElement;
  if (!root) {
    return;
  }

  root.style.zoom = "";
  const availableWidth = frame.clientWidth;
  const contentWidth = root.scrollWidth;
  const zoom =
    availableWidth > 0 && contentWidth > availableWidth
      ? Math.max(availableWidth / contentWidth, minimumMessageZoom)
      : 1;
  if (zoom < 1) {
    root.style.zoom = String(zoom);
  }

  root.style.overflowY = "hidden";
  // Engines disagree on whether zoomed rects are reported in zoomed or unzoomed pixels; the
  // root always spans the frame width, so its width ratio converts either one to frame pixels.
  const rect = root.getBoundingClientRect();
  const toFramePixels = rect.width > 0 ? availableWidth / rect.width : 1;
  frame.style.height = `${Math.ceil(rect.height * toFramePixels)}px`;
}
