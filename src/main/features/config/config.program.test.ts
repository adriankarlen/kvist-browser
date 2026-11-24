import { expect, test } from "vite-plus/test";
import { DEFAULT_CONFIG, DEFAULT_SETTINGS } from "../../../shared/config";
import { Msg as MessagesMsg } from "../messages/messages.program";
import { Msg as VimMsg } from "../vim/vim.program";
import { Cmd, init, Msg, update } from "./config.program";

const config = DEFAULT_CONFIG;
const recipes = ["modern", "tui"];

test("a loaded config is applied, and only published once it has been", () => {
  const loaded = update(Msg.cases.ConfigLoaded.make({ config, problems: [], recipes }), init);

  expect(loaded.model.current).toBeNull();
  expect(loaded.cmds).toEqual([Cmd.cases.ApplyConfig.make({ config })]);
  expect(update(Msg.cases.ConfigApplied.make({ config }), loaded.model).model.current).toEqual(
    config,
  );
});

test("the first problem is shown with a count, and the rest go to the log", () => {
  const problems = [
    { field: "homepage", reason: "not a string" },
    { field: "config.toml", reason: "Expected a value at line 1, column 5" },
  ];

  const { msgs, cmds } = update(Msg.cases.ConfigLoaded.make({ config, problems, recipes }), init);

  expect(msgs).toEqual([
    MessagesMsg.cases.MessageShown.make({
      message: { text: "config.toml: homepage: not a string (+1 more)", level: "error" },
    }),
  ]);
  expect(cmds[0]).toEqual(
    Cmd.cases.LogProblems.make({ lines: ["config.toml: Expected a value at line 1, column 5"] }),
  );
});

test("a style problem names the file, not its whole path", () => {
  const { msgs } = update(
    Msg.cases.StylesApplied.make({
      problems: [{ id: "/home/u/.config/kvist/styles/a.css", reason: "bad" }],
    }),
    init,
  );

  expect(msgs).toEqual([
    MessagesMsg.cases.MessageShown.make({ message: { text: "a.css: bad", level: "error" } }),
  ]);
});

test("the input mode reaches the mode machine on the first apply, then only when it changes", () => {
  const standard = {
    ...config,
    settings: { ...DEFAULT_SETTINGS, inputMode: "standard" as const },
  };

  const switched = VimMsg.cases.InputModeChanged.make({ scheme: "standard" });
  const first = update(Msg.cases.ConfigApplied.make({ config: standard }), init);

  expect(first.msgs).toEqual([switched]);
  expect(update(Msg.cases.ConfigApplied.make({ config: standard }), first.model).msgs).toEqual([]);
  expect(update(Msg.cases.ConfigApplied.make({ config }), first.model).msgs).toEqual([
    VimMsg.cases.InputModeChanged.make({ scheme: "vim" }),
  ]);
});

test("a recipe problem names its own file", () => {
  const { msgs } = update(
    Msg.cases.ConfigLoaded.make({
      config,
      recipes,
      problems: [{ file: "recipes/x.toml", field: "input.mode", reason: "bad" }],
    }),
    init,
  );

  expect(msgs).toEqual([
    MessagesMsg.cases.MessageShown.make({
      message: { text: "recipes/x.toml: input.mode: bad", level: "error" },
    }),
  ]);
});
