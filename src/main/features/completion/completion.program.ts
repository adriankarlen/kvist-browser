import { Schema } from "effect";
import { CompletionOverlayState } from "../../../shared/schema/completion";
import { next, type Next } from "../../../shared/tea/program";

/**
 * The completion list main paints on the chrome's behalf. The chrome owns
 * the list and its selection; this is the mirror, plus the height only the
 * overlay can measure. The view that paints it is `CompletionOverlay`.
 */
export interface Model {
  readonly state: CompletionOverlayState | null;
  /** The rendered list's height, or null before the overlay has measured one. */
  readonly height: number | null;
}

export const init: Model = { state: null, height: null };

export const Msg = Schema.TaggedUnion({
  CompletionChanged: { state: Schema.NullOr(CompletionOverlayState) },
  CompletionHeightMeasured: { height: Schema.Finite },
});

export type Msg = typeof Msg.Type;

export function update(msg: Msg, model: Model): Next<Model, never, never> {
  return Msg.match(msg, {
    CompletionChanged: ({ state }) => next({ ...model, state }),
    // A hidden list measures zero; keeping the last real height means a
    // reopened list is placed right before it has measured again.
    CompletionHeightMeasured: ({ height }) => next(height === 0 ? model : { ...model, height }),
  });
}
