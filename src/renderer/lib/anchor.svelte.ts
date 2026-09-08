import type { Rect } from "../../shared/ipc";

/**
 * Tracks where an input sits, so the completion overlay can be anchored to
 * it. The list is painted in a `WebContentsView` main places, and this is
 * the half of that placement only the chrome can measure.
 *
 * Reports the border box rather than the content box, the opposite of
 * `createContentRect`: a tab's view has to stay clear of the chrome's own
 * border, but the dropdown is drawn flush against the input's outer edge.
 */
export function createAnchor() {
  // Raw, not deep: the box is replaced wholesale on every report, and a
  // `$state` proxy cannot cross IPC — structured clone rejects it, which
  // kills the effect that pushes it.
  let rect = $state.raw<Rect | null>(null);

  return {
    get current(): Rect | null {
      return rect;
    },
    element(node: HTMLElement) {
      const report = (): void => {
        const box = node.getBoundingClientRect();
        // Reported unrounded. The chrome's own padding is measured in `ch`,
        // so this box rarely lands on a whole pixel, and main needs the
        // fraction to place the list's border exactly on the panel's.
        rect = { x: box.x, y: box.y, width: box.width, height: box.height };
      };

      const observer = new ResizeObserver(report);
      observer.observe(node);
      window.addEventListener("resize", report);
      report();

      return {
        destroy() {
          observer.disconnect();
          window.removeEventListener("resize", report);
        },
      };
    },
  };
}
