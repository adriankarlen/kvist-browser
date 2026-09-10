import type { Rect } from "../../shared/ipc";

/** Report the element's border box so the dropdown meets its outer edge. */
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
