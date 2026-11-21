import type { TabId } from "../shared/schema/browser";
import type { Layout } from "./features/tabs/tabs.program";
import type { Tab } from "./tab";

export type Placeable = Pick<Tab, "setVisible" | "setBounds">;

/**
 * The layout last applied to the page views. A new tab's layout and view
 * arrive on separate fibers, in no fixed order. A view made after its
 * layout arrived must still be shown: that layout is not published again.
 */
export class TabLayout {
  #applied: Layout | null = null;

  /** Puts a newly created tab where the applied layout says it belongs. */
  place(id: TabId, tab: Placeable): void {
    const applied = this.#applied;
    const visible = applied?.visible === id;

    tab.setVisible(visible);

    if (visible) tab.setBounds(applied.bounds);
  }

  /** Applies a new layout, touching only what changed. */
  reconcile(layout: Layout, tabs: ReadonlyMap<TabId, Placeable>): void {
    const previous = this.#applied;

    for (const [id, tab] of tabs) {
      const visible = id === layout.visible;

      if (previous === null || (id === previous.visible) !== visible) tab.setVisible(visible);
    }

    if (layout.visible !== null) tabs.get(layout.visible)?.setBounds(layout.bounds);
    this.#applied = layout;
  }
}
