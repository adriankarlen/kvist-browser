import { expect, test } from "vite-plus/test";
import { init, Msg, update } from "./completion.program";

const state = {
  candidates: [{ label: "a", value: "a" }],
  index: -1,
  anchor: { x: 0, y: 0, width: 100, height: 20 },
  grow: "down" as const,
};

test("the list mirrors what the chrome sent, and null hides it", () => {
  const shown = update(Msg.cases.CompletionChanged.make({ state }), init).model;

  expect(shown.state).toEqual(state);
  expect(update(Msg.cases.CompletionChanged.make({ state: null }), shown).model.state).toBeNull();
});

test("a zero height keeps the last measured one", () => {
  const measured = update(Msg.cases.CompletionHeightMeasured.make({ height: 60 }), init).model;

  expect(
    update(Msg.cases.CompletionHeightMeasured.make({ height: 0 }), measured).model.height,
  ).toBe(60);
});
