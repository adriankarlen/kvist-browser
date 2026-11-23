import { Schema } from "effect";
import type { Placement } from "../../../shared/layout";
import { next, type Next } from "../../../shared/tea/program";
import type { Model as MainModel } from "../main/main.program";

/** How long the tab strip stays out after a tab opens, closes or is switched to. */
export const PEEK_AFTER_SHIFT = 2000;

/** A short grace after the pointer leaves, so crossing the edge does not flicker. */
export const PEEK_AFTER_LEAVE = 400;

/** What the chrome decides about showing elements; where they go is config. */
export interface Model {
  readonly tabsHovered: boolean;
  readonly tabsPeeking: boolean;
  /** Main asked for the omnibox while the layout hides it. */
  readonly omniboxSummoned: boolean;
}

export const init: Model = { tabsHovered: false, tabsPeeking: false, omniboxSummoned: false };

export const Msg = Schema.TaggedUnion({
  TabStripHovered: {},
  TabStripLeft: {},
  /** The active tab or the set of tabs changed. */
  TabsShifted: {},
  TabStripPeekEnded: {},
  OmniboxSummoned: {},
  OmniboxDismissed: {},
});

export type Msg = typeof Msg.Type;

export const Cmd = Schema.TaggedUnion({
  /** Keyed: a newer peek restarts the wait. */
  PeekTabStrip: { millis: Schema.Number },
});

export type Cmd = typeof Cmd.Type;

const peek = (model: Model, millis: number): Next<Model, never, Cmd> =>
  next({ ...model, tabsPeeking: true }, [Cmd.cases.PeekTabStrip.make({ millis })]);

export function update(msg: Msg, model: Model): Next<Model, never, Cmd> {
  return Msg.match(msg, {
    TabStripHovered: () => next({ ...model, tabsHovered: true }),
    TabStripLeft: () => peek({ ...model, tabsHovered: false }, PEEK_AFTER_LEAVE),
    TabsShifted: () => peek(model, PEEK_AFTER_SHIFT),
    TabStripPeekEnded: () => next({ ...model, tabsPeeking: false }),
    OmniboxSummoned: () => next({ ...model, omniboxSummoned: true }),
    OmniboxDismissed: () => next({ ...model, omniboxSummoned: false }),
  });
}

/** Tucked is the thin edge an auto-hidden strip leaves to hover over. */
export type TabStripState = "shown" | "tucked" | "gone";

export function tabStrip(model: Model, placement: Placement): TabStripState {
  if (!placement.visible) return "gone";

  if (!placement.autohide) return "shown";

  return model.tabsHovered || model.tabsPeeking ? "shown" : "tucked";
}

export const omniboxShown = (model: Model, placement: Placement): boolean =>
  placement.visible || model.omniboxSummoned;

/** Find outlives its prompt so n and N keep their matches lit, unless the layout hides it. */
export const findShown = (main: MainModel, placement: Placement): boolean =>
  main.mode === "find" || (placement.visible && main.findResult !== null);

export type StatusLine = "command" | "prompt" | "message";

/**
 * The status row is the command line, a prompt or a message, in that order.
 * A hidden row still shows errors, or a command that failed would say nothing.
 */
export function statusLine(main: MainModel, placement: Placement): StatusLine | null {
  if (main.mode === "command") return "command";

  if (main.prompt !== null) return "prompt";

  if (main.message === null) return null;

  return placement.visible || main.message.level === "error" ? "message" : null;
}
