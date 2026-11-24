import { expect, test } from "vite-plus/test";
import { Msg as VimMsg } from "../vim/vim.program";
import { init, Msg, update } from "./palette.program";

const summon = (text: string, model = init) =>
  update(Msg.cases.PaletteSummoned.make({ text }), model).model;

test("summoning opens the palette with its starting text", () => {
  expect(summon("https://example.com/")).toEqual({
    open: true,
    text: "https://example.com/",
    seq: 1,
  });
});

test("summoning an open palette replaces its text and counts as a new opening", () => {
  const first = summon("https://example.com/");
  const again = summon(":", first);

  expect(again).toEqual({ open: true, text: ":", seq: 2 });
  expect(summon(":", again).seq).toBe(3);
});

test("dismissing closes it and ends typing, but hands the keyboard back only when asked", () => {
  const open = summon(":");
  const handedBack = update(Msg.cases.PaletteDismissed.make({ handBack: true }), open);

  expect(handedBack.model.open).toBe(false);
  expect(handedBack.msgs).toEqual([VimMsg.cases.ModeRequested.make({ mode: "normal" })]);

  const kept = update(Msg.cases.PaletteDismissed.make({ handBack: false }), open);

  expect(kept.model.open).toBe(false);
  expect(kept.msgs).toEqual([VimMsg.cases.ChromeInputClosed.make({})]);
});

test("dismissing a closed palette does nothing", () => {
  const next = update(Msg.cases.PaletteDismissed.make({ handBack: true }), init);

  expect(next.model).toBe(init);
  expect(next.msgs).toEqual([]);
});
