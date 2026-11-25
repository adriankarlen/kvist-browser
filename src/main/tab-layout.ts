import type { TabId } from "../shared/schema/browser";
import type { Layout } from "./features/tabs/tabs.program";
import type { Tab } from "./tab";

export type Placeable = Pick<Tab, "setVisible" | "setBounds" | "setBorderRadius">;

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

    if (!visible) return;
    tab.setBounds(applied.bounds);
    tab.setBorderRadius(applied.radius);
  }

  /**
   * Applies a new layout, touching only what changed. A hidden tab keeps a
   * radius that may be stale, so the radius is set again whenever a tab is
   * shown.
   */
  reconcile(layout: Layout, tabs: ReadonlyMap<TabId, Placeable>): void {
    const previous = this.#applied;

    for (const [id, tab] of tabs) {
      const visible = id === layout.visible;

      if (previous === null || (id === previous.visible) !== visible) tab.setVisible(visible);
    }

    const shown = layout.visible === null ? undefined : tabs.get(layout.visible);

    shown?.setBounds(layout.bounds);

    if (previous?.visible !== layout.visible || previous.radius !== layout.radius)
      shown?.setBorderRadius(layout.radius);

    this.#applied = layout;
  }
}
