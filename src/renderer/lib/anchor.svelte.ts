import type { Rect } from "../../shared/schema/browser";
import { afterLayoutChange } from "./stores.svelte";

/**
 * Report the element's border box so the dropdown meets its outer edge.
 * `preferred` names a descendant to report instead, whenever it draws a box:
 * a `display: contents` element measures as an empty rectangle.
 */
export function createAnchor(preferred?: string) {
  // Raw, not deep: the box is replaced wholesale on every report, and a
  // `$state` proxy cannot cross IPC — structured clone rejects it, which
  // kills the effect that pushes it.
  let rect = $state.raw<Rect | null>(null);

  return {
    get current(): Rect | null {
      return rect;
    },
    element(node: HTMLElement) {
      const inner = preferred === undefined ? null : node.querySelector(preferred);

      const target = (): Element =>
        inner !== null && inner.getBoundingClientRect().width > 0 ? inner : node;

      const report = (): void => {
        const box = target().getBoundingClientRect();
        // Reported unrounded. The chrome's own padding is measured in `ch`,
        // so this box rarely lands on a whole pixel, and main needs the
        // fraction to place the list's border exactly on the panel's.
        rect = { x: box.x, y: box.y, width: box.width, height: box.height };
      };

      const observer = new ResizeObserver(report);
      observer.observe(node);

      if (inner !== null) observer.observe(inner);

      // Something above the anchor in its region can appear or grow, moving
      // it without resizing it. The region resizes when that happens.
      const region = node.closest(".kv-region");

      if (region !== null) observer.observe(region);
      window.addEventListener("resize", report);
      afterLayoutChange(report);

      return {
        destroy() {
          observer.disconnect();
          window.removeEventListener("resize", report);
        },
      };
    },
  };
}
