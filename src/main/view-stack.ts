import type { View } from "electron";

/**
 * The part of a window's `contentView` a stack drives. Narrowed with `Pick`
 * for the same reason `PageHost` is: an adapter that cannot contain logic is
 * an adapter a fake cannot drift from.
 */
export type StackRoot = Pick<View, "addChildView" | "removeChildView">;

/**
 * Who sits on top of whom inside a window's `contentView`.
 *
 * Tab views and chrome overlays are siblings composited in the order they
 * were added, so a tab opened while a completion menu is up would be painted
 * straight over it. Electron re-orders a child to the top when it is added a
 * second time, which is what every `addPage` ends with: the overlays go back
 * over the page they belong in front of.
 *
 * The alternative — raising the overlay from each site that mounts a tab —
 * is one forgotten call away from the bug it fixes, so the invariant lives
 * here instead.
 */
export class ViewStack {
  #root: StackRoot;
  /** Registration order, which is also the order they composite in. */
  #overlays: View[] = [];

  constructor(root: StackRoot) {
    this.#root = root;
  }

  /** Mounts a page view below every overlay. */
  addPage(view: View): void {
    this.#root.addChildView(view);
    this.#raiseOverlays();
  }

  /** Mounts an overlay on top, and keeps it there as pages come and go. */
  addOverlay(view: View): void {
    if (!this.#overlays.includes(view)) this.#overlays.push(view);
    this.#root.addChildView(view);
  }

  remove(view: View): void {
    const index = this.#overlays.indexOf(view);
    if (index >= 0) this.#overlays.splice(index, 1);
    this.#root.removeChildView(view);
  }

  #raiseOverlays(): void {
    for (const overlay of this.#overlays) this.#root.addChildView(overlay);
  }
}
