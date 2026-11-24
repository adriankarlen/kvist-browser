import { Schema } from "effect";
import { next, type Next } from "../../../shared/tea/program";
import { type Msg as VimMsg, Msg as VimMsgs } from "../vim/vim.program";

/**
 * Whether the command palette is up, and what it opened with. The view that
 * paints it is `PaletteOverlay`; its draft lives in the palette's own loop.
 */
export interface Model {
  readonly open: boolean;
  /** The text the input starts with: the URL for `o`, a colon for `:`. */
  readonly text: string;
  /** Bumped on every summon, so summoning an open palette resets its draft. */
  readonly seq: number;
}

export const init: Model = { open: false, text: "", seq: 0 };

export const Msg = Schema.TaggedUnion({
  PaletteSummoned: { text: Schema.String },
  /** `handBack` returns the keyboard to the page, as Escape does. Either way, typing ends. */
  PaletteDismissed: { handBack: Schema.Boolean },
});

export type Msg = typeof Msg.Type;

const toNormal = VimMsgs.cases.ModeRequested.make({ mode: "normal" });
const inputClosed = VimMsgs.cases.ChromeInputClosed.make({});

export function update(msg: Msg, model: Model): Next<Model, VimMsg, never> {
  return Msg.match(msg, {
    PaletteSummoned: ({ text }) => next({ open: true, text, seq: model.seq + 1 }),
    PaletteDismissed: ({ handBack }) => {
      if (!model.open) return next(model);

      return next({ ...model, open: false }, [], [handBack ? toNormal : inputClosed]);
    },
  });
}
