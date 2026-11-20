import { expect, test } from "vite-plus/test";
import { OverlayEvent, OverlayIntent } from "../shared/rpc/overlay";
import { Cmd, Msg, program } from "./overlay.program";

const state = {
  candidates: [{ label: "a", value: "https://a/" }],
  index: 0,
  anchor: { x: 0, y: 0, width: 100, height: 20 },
  grow: "down" as const,
};

test("the rows and the inset are whatever main last sent", () => {
  const shown = program.update(
    OverlayEvent.cases.CompletionStateChanged.make({ state }),
    program.init.model,
  );

  expect(shown.model.state).toEqual(state);
});

test("a click reports the candidate itself, and a retheme is injected", () => {
  const candidate = state.candidates[0]!;

  expect(program.update(Msg.cases.RowClicked.make({ candidate }), program.init.model).cmds).toEqual(
    [
      Cmd.cases.SendToMain.make({
        intent: OverlayIntent.cases.CompletionClicked.make({ candidate }),
      }),
    ],
  );
  expect(
    program.update(OverlayEvent.cases.CompletionCssChanged.make({ css: "x" }), program.init.model)
      .cmds,
  ).toEqual([Cmd.cases.InjectCss.make({ css: "x" })]);
});
