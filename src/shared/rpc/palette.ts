import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { CompletionCandidate, OmniboxSuggestion } from "../schema/completion";

/** What main tells the command palette. Both are state, so a late document starts current. */
export const PaletteEvent = Schema.TaggedUnion({
  /** Summoned: start over from `text`. `seq` tells two openings with the same text apart. */
  Opened: {
    text: Schema.String,
    seq: Schema.Int,
    /** `[layout.omnibox] size`: the panel's width. Undefined keeps the theme's. */
    size: Schema.UndefinedOr(Schema.String),
  },
  /** `themeCss`: the recipe and config.css, so a retheme reaches the palette too. */
  CssChanged: { css: Schema.String },
});

export type PaletteEvent = typeof PaletteEvent.Type;

export const PaletteIntent = Schema.TaggedUnion({
  /** Typed text, not a picked row: main resolves it to a URL or a search. */
  Submitted: { text: Schema.String },
  SuggestionPicked: { candidate: CompletionCandidate },
  /** A line typed after the leading colon. */
  CommandEntered: { line: Schema.String },
  /** Escape or a click beside the panel. */
  Dismissed: {},
});

export type PaletteIntent = typeof PaletteIntent.Type;

export class PaletteRpcs extends RpcGroup.make(
  Rpc.make("Subscribe", { success: PaletteEvent, stream: true }),
  Rpc.make("Dispatch", { payload: PaletteIntent }),
  Rpc.make("Suggestions", {
    payload: { query: Schema.String },
    success: Schema.Array(OmniboxSuggestion),
  }),
  Rpc.make("CommandCompletions", {
    payload: { line: Schema.String },
    success: Schema.Array(CompletionCandidate),
  }),
) {}
