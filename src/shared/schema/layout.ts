import { Schema } from "effect";

export const REGIONS = ["top", "bottom", "left", "right", "floating", "overlay"] as const;

export const Region = Schema.Literals(REGIONS);

export type Region = typeof Region.Type;

/** In default order: the order that breaks ties inside a region. */
export const ELEMENT_IDS = [
  "tabs",
  "omnibox",
  "bookmarks",
  "downloads",
  "status",
  "find",
  "completion",
] as const;

export const ElementId = Schema.Literals(ELEMENT_IDS);

export type ElementId = typeof ElementId.Type;

export const Placement = Schema.Struct({
  region: Region,
  order: Schema.Int,
  /** A CSS length for the element's thickness across its region. Undefined keeps the theme's. */
  size: Schema.UndefinedOr(Schema.String),
  visible: Schema.Boolean,
});

export type Placement = typeof Placement.Type;

export const Layout = Schema.Struct({
  tabs: Placement,
  omnibox: Placement,
  bookmarks: Placement,
  downloads: Placement,
  status: Placement,
  find: Placement,
  completion: Placement,
});

export type Layout = typeof Layout.Type;
