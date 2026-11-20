import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { Point, ScrollCommand } from "../schema/browser";
import { ContextMenuState } from "../schema/context-menu";

/** What main tells a tab. Hints, scrolling and the context menu all live in the page. */
export const PageEvent = Schema.TaggedUnion({
  /** Blur whatever the page has focused, so normal mode regains the keyboard. */
  BlurRequested: {},
  ScrollRequested: { command: ScrollCommand },
  HintsShown: {},
  HintKeyPressed: { key: Schema.String },
  HintsHidden: {},
  /** Rendered in the page, because the tab's view paints over the chrome. */
  ContextMenuChanged: { menu: Schema.NullOr(ContextMenuState) },
});

export type PageEvent = typeof PageEvent.Type;

export const PageIntent = Schema.TaggedUnion({
  /** Whether the focused element accepts typing. */
  EditableChanged: { editable: Schema.Boolean },
  /**
   * Where the page wants a real click. A scripted `.click()` has no user
   * activation, so Chromium would mark the history entry skippable.
   */
  HintClicked: { point: Point },
  HintsEnded: {},
  /** The picked item id, or null when the menu was dismissed without one. */
  ContextMenuPicked: { id: Schema.NullOr(Schema.String) },
});

export type PageIntent = typeof PageIntent.Type;

export class PageRpcs extends RpcGroup.make(
  Rpc.make("Subscribe", { success: PageEvent, stream: true }),
  Rpc.make("Dispatch", { payload: PageIntent }),
) {}
