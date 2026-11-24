import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { CompletionCandidate, CompletionInset, CompletionOverlayState } from "../schema/completion";

/** What main tells the completion overlay: a list's worth, and no more. */
export const OverlayEvent = Schema.TaggedUnion({
  CompletionStateChanged: { state: CompletionOverlayState },
  /** Where to draw the list inside the view main has sized for it. */
  CompletionInsetChanged: { inset: CompletionInset },
  /** `themeCss`: the recipe and config.css, so a retheme reaches the menu too. */
  CompletionCssChanged: { css: Schema.String },
});

export type OverlayEvent = typeof OverlayEvent.Type;

export const OverlayIntent = Schema.TaggedUnion({
  /** How tall the list rendered. Only the overlay knows its row heights. */
  CompletionMeasured: { height: Schema.Finite },
  /** The candidate itself, not its index: the click blurs the input and may clear its list first. */
  CompletionClicked: { candidate: CompletionCandidate },
});

export type OverlayIntent = typeof OverlayIntent.Type;

export class OverlayRpcs extends RpcGroup.make(
  Rpc.make("Subscribe", { success: OverlayEvent, stream: true }),
  Rpc.make("Dispatch", { payload: OverlayIntent }),
) {}
