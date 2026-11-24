import { expect, test } from "vite-plus/test";
import { PaletteIntent } from "../shared/rpc/palette";
import { Cmd, commandOf, Msg, program } from "./palette.program";

const I = PaletteIntent.cases;
const sent = (msg: Msg) => program.update(msg, program.init.model).cmds;
const toMain = (intent: PaletteIntent) => [Cmd.cases.SendToMain.make({ intent })];

test("an opening replaces the last one", () => {
  const first = program.update(
    Msg.cases.Opened.make({ text: "https://a.test/", seq: 1, size: undefined }),
    program.init.model,
  ).model;

  const second = program.update(Msg.cases.Opened.make({ text: ":", seq: 2, size: "60ch" }), first);

  expect(second.model.opening).toEqual({ text: ":", seq: 2, size: "60ch" });
});

test("only a leading colon makes a command", () => {
  expect(commandOf(":tab.new x")).toBe("tab.new x");
  expect(commandOf(":")).toBe("");
  expect(commandOf("a:b")).toBeNull();
});

test("typed text goes to main to resolve, and a colon line runs as a command", () => {
  expect(sent(Msg.cases.DraftSubmitted.make({ draft: "kvist" }))).toEqual(
    toMain(I.Submitted.make({ text: "kvist" })),
  );

  expect(sent(Msg.cases.DraftSubmitted.make({ draft: ":tab.new" }))).toEqual(
    toMain(I.CommandEntered.make({ line: "tab.new" })),
  );
});

test("a picked row, a dismissal and a retheme each become their Cmd", () => {
  const candidate = { label: "Docs", value: "7", kind: "tab" };

  expect(sent(Msg.cases.RowAccepted.make({ candidate }))).toEqual(
    toMain(I.SuggestionPicked.make({ candidate })),
  );

  expect(sent(Msg.cases.DismissRequested.make({}))).toEqual(toMain(I.Dismissed.make({})));

  expect(sent(Msg.cases.CssChanged.make({ css: "a{}" }))).toEqual([
    Cmd.cases.InjectCss.make({ css: "a{}" }),
  ]);
});
