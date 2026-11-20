import { expect, test } from "vite-plus/test";
import { PageEvent, PageIntent } from "../shared/rpc/page";
import { Cmd, type Model, Msg, program } from "./page.program";

const C = Cmd.cases;
const ended = C.SendToMain.make({ intent: PageIntent.cases.HintsEnded.make({}) });

function run(msgs: ReadonlyArray<Msg>, model: Model = program.init.model) {
  const cmds: Cmd[] = [];

  for (const msg of msgs) {
    const result = program.update(msg, model);

    model = result.model;
    cmds.push(...result.cmds);
  }

  return { model, cmds };
}

const up = run([Msg.cases.HintsRendered.make({ labels: ["aa", "as", "ad"] })]).model;

test("showing hints renders markers; nothing to hint ends hint mode at once", () => {
  expect(run([PageEvent.cases.HintsShown.make({})]).cmds).toEqual([C.RenderHints.make({})]);
  expect(run([Msg.cases.HintsRendered.make({ labels: [] })]).cmds).toEqual([ended]);
});

test("typing narrows the labels, and a full match activates it and ends hinting", () => {
  const narrowed = run([PageEvent.cases.HintKeyPressed.make({ key: "a" })], up);

  expect(narrowed.cmds).toEqual([C.DimHints.make({ typed: "a" })]);
  expect(run([PageEvent.cases.HintKeyPressed.make({ key: "s" })], narrowed.model).cmds).toEqual([
    C.ActivateHint.make({ label: "as" }),
    ended,
  ]);
});

test("a key no label can start ends hinting; Backspace steps back; other keys are ignored", () => {
  expect(
    run(
      [
        PageEvent.cases.HintKeyPressed.make({ key: "a" }),
        PageEvent.cases.HintKeyPressed.make({ key: "l" }),
      ],
      up,
    ).cmds,
  ).toContainEqual(ended);
  expect(
    run(
      [
        PageEvent.cases.HintKeyPressed.make({ key: "a" }),
        PageEvent.cases.HintKeyPressed.make({ key: "Backspace" }),
      ],
      up,
    ).model.hints?.typed,
  ).toBe("");
  expect(run([PageEvent.cases.HintKeyPressed.make({ key: "Shift" })], up).model).toBe(up);
});

test("scrolling under the markers ends hinting; scrolling without them does nothing", () => {
  expect(run([Msg.cases.PageScrolled.make({})], up).cmds).toEqual([C.HideHints.make({}), ended]);
  expect(run([Msg.cases.PageScrolled.make({})]).cmds).toEqual([]);
});

test("focus changes are reported once each", () => {
  const typing = run([Msg.cases.FocusChanged.make({ editable: true })]);

  expect(typing.cmds).toHaveLength(1);
  expect(run([Msg.cases.FocusChanged.make({ editable: true })], typing.model).cmds).toEqual([]);
});
