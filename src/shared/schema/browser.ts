import { Schema } from "effect";

export const TabId = Schema.Int;

export type TabId = typeof TabId.Type;

export const Mode = Schema.Literals(["normal", "insert", "command", "hint", "find", "prompt"]);

export type Mode = typeof Mode.Type;

/** Scrolling lives in the page, so main names the movement rather than the pixels. */
export const ScrollCommand = Schema.Literals([
  "down",
  "up",
  "half-down",
  "half-up",
  "top",
  "bottom",
]);

export type ScrollCommand = typeof ScrollCommand.Type;

export const Rect = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
});

export type Rect = typeof Rect.Type;

export const Point = Schema.Struct({ x: Schema.Finite, y: Schema.Finite });

export type Point = typeof Point.Type;

export const TabState = Schema.Struct({
  id: TabId,
  title: Schema.String,
  url: Schema.String,
  favicon: Schema.NullOr(Schema.String),
  loading: Schema.Boolean,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
  /** The page's zoom level (0 = 100%, ±1 ≈ 20% a step), so the chrome can show it. */
  zoomLevel: Schema.Finite,
  /** Whether at least one bookmark points at this URL. */
  bookmarked: Schema.Boolean,
});

export type TabState = typeof TabState.Type;

export const BrowserState = Schema.Struct({
  tabs: Schema.Array(TabState),
  activeId: Schema.NullOr(TabId),
});

export type BrowserState = typeof BrowserState.Type;

/** Where a find has got to, as `found-in-page` reports it. */
export const FindResult = Schema.Struct({
  query: Schema.String,
  matches: Schema.Int,
  /** 1-based index of the highlighted match; 0 when there are none. */
  active: Schema.Int,
});

export type FindResult = typeof FindResult.Type;

/**
 * A line of feedback for the echo area. `error` is for something the user
 * did or wrote that could not be used; `info` for everything else.
 */
export const Message = Schema.Struct({
  text: Schema.String,
  level: Schema.Literals(["info", "error"]),
});

export type Message = typeof Message.Type;
