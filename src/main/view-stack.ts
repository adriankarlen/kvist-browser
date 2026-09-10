import type { View } from "electron";

/** The part of a window's contentView a stack drives. */
export type StackRoot = Pick<View, "addChildView" | "removeChildView">;

/**
 * Keep overlays above newly mounted tabs.
 * Electron raises an existing child when it is added again.
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
    if (this.#overlays.includes(view)) return;
    this.#overlays.push(view);
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
