import { ELEMENT_IDS, type ElementId, type Layout, type Region } from "./schema/layout";

export type { ElementId, Layout, Placement, Region } from "./schema/layout";

export { ELEMENT_IDS, REGIONS } from "./schema/layout";

const defaultOrder = (id: ElementId): number => ELEMENT_IDS.indexOf(id);

const placed = (id: ElementId, region: Region) => ({
  region,
  order: defaultOrder(id),
  size: undefined,
  visible: true,
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
  readonly hideable: boolean;
}

const EVERY_EDGE: ReadonlyArray<Region> = ["top", "bottom", "left", "right"];
const TOP_OR_BOTTOM: ReadonlyArray<Region> = ["top", "bottom"];

/**
 * What each element is built to handle today. The model names more on
 * purpose: a placement only renders well once its element is built for it.
 * KVI-57, KVI-58 and KVI-59 widen this table.
 */
export const SUPPORT: Readonly<Record<ElementId, Support>> = {
  tabs: { regions: EVERY_EDGE, hideable: true },
  omnibox: { regions: ["top"], hideable: false },
  bookmarks: { regions: EVERY_EDGE, hideable: false },
  downloads: { regions: EVERY_EDGE, hideable: false },
  status: { regions: TOP_OR_BOTTOM, hideable: false },
  find: { regions: TOP_OR_BOTTOM, hideable: false },
  completion: { regions: ["overlay"], hideable: false },
};

/** The visible elements of each region, sorted by order and then by default order. */
export function arrange(layout: Layout): Readonly<Record<Region, ReadonlyArray<ElementId>>> {
  const byPosition = (a: ElementId, b: ElementId): number =>
    layout[a].order - layout[b].order || defaultOrder(a) - defaultOrder(b);

  const inRegion = (region: Region): ReadonlyArray<ElementId> =>
    ELEMENT_IDS.filter((id) => layout[id].visible && layout[id].region === region).toSorted(
      byPosition,
    );

  return {
    top: inRegion("top"),
    bottom: inRegion("bottom"),
    left: inRegion("left"),
    right: inRegion("right"),
    floating: inRegion("floating"),
    overlay: inRegion("overlay"),
  };
}

export type TabStripDirection = "horizontal" | "vertical";

export const isSideRegion = (region: Region): boolean => region === "left" || region === "right";

export const tabStripDirection = (region: Region): TabStripDirection =>
  isSideRegion(region) ? "vertical" : "horizontal";
