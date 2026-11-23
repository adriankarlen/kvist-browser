import type { Rect } from "./schema/browser";
import type { CompletionGrow } from "./schema/completion";
import { ELEMENT_IDS, type ElementId, type Layout, type Region } from "./schema/layout";

export type { ElementId, Layout, Placement, Region } from "./schema/layout";

export { ELEMENT_IDS, REGIONS } from "./schema/layout";

const defaultOrder = (id: ElementId): number => ELEMENT_IDS.indexOf(id);

const placed = (id: ElementId, region: Region) => ({
  region,
  order: defaultOrder(id),
  size: undefined,
  visible: true,
  autohide: false,
});

export const DEFAULT_LAYOUT: Layout = {
  tabs: placed("tabs", "top"),
  omnibox: placed("omnibox", "top"),
  bookmarks: placed("bookmarks", "bottom"),
  downloads: placed("downloads", "bottom"),
  status: placed("status", "bottom"),
  find: placed("find", "bottom"),
  completion: placed("completion", "overlay"),
};

interface Support {
  readonly regions: ReadonlyArray<Region>;
  readonly autohide: boolean;
}

const EVERY_EDGE: ReadonlyArray<Region> = ["top", "bottom", "left", "right"];

/**
 * What each element is built to handle today. The model names more on
 * purpose: a placement only renders well once its element is built for it.
 * KVI-58 and KVI-59 widen this table.
 */
export const SUPPORT: Readonly<Record<ElementId, Support>> = {
  tabs: { regions: EVERY_EDGE, autohide: true },
  omnibox: { regions: ["top"], autohide: false },
  bookmarks: { regions: EVERY_EDGE, autohide: false },
  downloads: { regions: EVERY_EDGE, autohide: false },
  status: { regions: EVERY_EDGE, autohide: false },
  find: { regions: EVERY_EDGE, autohide: false },
  completion: { regions: ["overlay"], autohide: false },
};

/**
 * The elements of each region, sorted by order and then by default order.
 * Hidden ones stay in: a hidden element still shows when summoned, and it
 * decides that itself.
 */
export function arrange(layout: Layout): Readonly<Record<Region, ReadonlyArray<ElementId>>> {
  const byPosition = (a: ElementId, b: ElementId): number =>
    layout[a].order - layout[b].order || defaultOrder(a) - defaultOrder(b);

  const inRegion = (region: Region): ReadonlyArray<ElementId> =>
    ELEMENT_IDS.filter((id) => layout[id].region === region).toSorted(byPosition);

  return {
    top: inRegion("top"),
    bottom: inRegion("bottom"),
    left: inRegion("left"),
    right: inRegion("right"),
    floating: inRegion("floating"),
    overlay: inRegion("overlay"),
  };
}

export type ElementDirection = "horizontal" | "vertical";

export const isSideRegion = (region: Region): boolean => region === "left" || region === "right";

export const elementDirection = (region: Region): ElementDirection =>
  isSideRegion(region) ? "vertical" : "horizontal";

/**
 * A list opens away from the window edge its input sits on. A side column
 * can put the input at any height, so there it opens towards the larger
 * half of the window.
 */
export function completionGrow(
  region: Region,
  anchor: Pick<Rect, "y" | "height">,
  viewportHeight: number,
): CompletionGrow {
  if (region === "top") return "down";

  if (!isSideRegion(region)) return "up";

  return anchor.y + anchor.height / 2 < viewportHeight / 2 ? "down" : "up";
}
