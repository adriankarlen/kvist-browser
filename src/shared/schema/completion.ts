import { Schema } from "effect";
import { Rect, TabId } from "./browser";

/**
 * One omnibox row: a concrete destination, not typed search text. `value` is
 * its URL. A `tab` row names an open tab, which accepting switches to.
 */
export const OmniboxSuggestion = Schema.Struct({
  label: Schema.String,
  value: Schema.String,
  kind: Schema.Literals(["tab", "bookmark", "history"]),
  tabId: Schema.optionalKey(TabId),
});

export type OmniboxSuggestion = typeof OmniboxSuggestion.Type;

/** One row of a completion list, generic over what is being completed. */
export const CompletionCandidate = Schema.Struct({
  label: Schema.String,
  value: Schema.String,
  hint: Schema.optionalKey(Schema.String),
  /**
   * A free-form tag such as "bookmark" or "command". It becomes a one-letter
   * badge coloured by `--kv-completion-kind-<kind>-fg`.
   */
  kind: Schema.optionalKey(Schema.String),
});

export type CompletionCandidate = typeof CompletionCandidate.Type;

/** The omnibox sits above the page and grows down; the command line grows up. */
export const CompletionGrow = Schema.Literals(["down", "up"]);

export type CompletionGrow = typeof CompletionGrow.Type;

/** What the overlay renders, and where. `anchor` is in the chrome's own coordinates. */
export const CompletionOverlayState = Schema.Struct({
  candidates: Schema.Array(CompletionCandidate),
  /** The highlighted row, or -1 when nothing is selected yet. */
  index: Schema.Int,
  anchor: Rect,
  grow: CompletionGrow,
});

export type CompletionOverlayState = typeof CompletionOverlayState.Type;

/**
 * Where the list sits inside its view, in CSS pixels. View bounds are whole
 * pixels but the omnibox is not, so the view contains the list exactly.
 */
export const CompletionInset = Schema.Struct({
  left: Schema.Finite,
  top: Schema.Finite,
  width: Schema.Finite,
});

export type CompletionInset = typeof CompletionInset.Type;
