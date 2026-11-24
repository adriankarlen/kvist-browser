import { describe, expect, test } from "vite-plus/test";
import { DEFAULT_CONFIG, DEFAULT_SETTINGS } from "../../../shared/config";
import type { Binding } from "../../../shared/schema/keymap";
import { Msg as MessagesMsg } from "../messages/messages.program";
import { Msg as VimMsg } from "../vim/vim.program";
import { Cmd, init, Msg, update } from "./config.program";

const config = DEFAULT_CONFIG;

/** A chord binding, as buildKeymap would hand it over. */
const binding = (notation: string, command: string): Binding => ({
  table: "chords",
  keys: [],
  notation,
  command,
});

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

test("the keymap reaches the mode machine on the first apply, then only when it changes", () => {
  const keymap = { name: "standard", bindings: [binding("Ctrl+T", "tab.new")] };

  const standard = {
    ...config,
    settings: { ...DEFAULT_SETTINGS, inputMode: "standard" as const, keymap },
  };

  const switched = VimMsg.cases.KeymapChanged.make({ scheme: "standard", keymap: keymap.bindings });
  const first = update(Msg.cases.ConfigApplied.make({ config: standard }), init);

  expect(first.msgs).toEqual([switched]);
  expect(update(Msg.cases.ConfigApplied.make({ config: standard }), first.model).msgs).toEqual([]);
  expect(update(Msg.cases.ConfigApplied.make({ config }), first.model).msgs).toEqual([
    VimMsg.cases.KeymapChanged.make({ scheme: "vim", keymap: config.settings.keymap.bindings }),
  ]);
});

test("a rebound key reaches the mode machine without an engine change", () => {
  const first = update(Msg.cases.ConfigApplied.make({ config }), init).model;
  const keymap = { name: "vim", bindings: [binding("J", "tab.next")] };
  const rebound = { ...config, settings: { ...config.settings, keymap } };

  expect(update(Msg.cases.ConfigApplied.make({ config: rebound }), first).msgs).toEqual([
    VimMsg.cases.KeymapChanged.make({ scheme: "vim", keymap: keymap.bindings }),
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

describe(":recipe", () => {
  const loaded = update(
    Msg.cases.ConfigApplied.make({ config }),
    update(Msg.cases.ConfigLoaded.make({ config, problems: [], recipes }), init).model,
  ).model;

  const choose = (name: string | undefined) =>
    update(Msg.cases.RecipeChosen.make({ name }), loaded);

  const shown = (text: string, level: "info" | "error") => [
    MessagesMsg.cases.MessageShown.make({ message: { text, level } }),
  ];

  test("with no name, says which recipe is in force and what else there is", () => {
    expect(choose(undefined).msgs).toEqual(shown("recipe tui (available: modern, tui)", "info"));
  });

  test("an unknown name is refused, and nothing is written", () => {
    const { msgs, cmds } = choose("nope");

    expect(cmds).toEqual([]);
    expect(msgs).toEqual(shown("no recipe named nope", "error"));
  });

  test("the recipe in force is not written again", () => {
    expect(choose("tui")).toMatchObject({
      cmds: [],
      msgs: shown("recipe tui is already in use", "info"),
    });
  });

  test("another recipe is written to config.toml", () => {
    expect(choose("modern").cmds).toEqual([Cmd.cases.WriteRecipe.make({ name: "modern" })]);
  });

  test("a second :recipe before the first applies compares against the pending one", () => {
    const pending = choose("modern").model;
    const back = update(Msg.cases.RecipeChosen.make({ name: "tui" }), pending);

    expect(back.cmds).toEqual([Cmd.cases.WriteRecipe.make({ name: "tui" })]);
    expect(update(Msg.cases.RecipeChosen.make({ name: "modern" }), pending).cmds).toEqual([]);
  });

  test("the pending choice ends when it applies, or when the save fails", () => {
    const pending = choose("modern").model;
    const modern = { ...config, recipe: { name: "modern", css: "" } };

    expect(update(Msg.cases.ConfigApplied.make({ config }), pending).model.pending).toBe("modern");
    expect(
      update(Msg.cases.ConfigApplied.make({ config: modern }), pending).model.pending,
    ).toBeNull();

    const failed = update(Msg.cases.RecipeNotSaved.make({ reason: "nope" }), pending);

    expect(failed.model.pending).toBeNull();
    expect(failed.msgs).toEqual(shown("nope", "error"));
  });
});

describe("preview", () => {
  const previewed = { ...config, recipe: { name: "test", css: ":root{}" } };
  const onDisk = { ...config, css: "/* saved */" };
  const apply = (c: typeof config) => Cmd.cases.ApplyConfig.make({ config: c });

  const loaded = update(Msg.cases.ConfigLoaded.make({ config, problems: [], recipes }), init).model;

  test("is applied in place of the files", () => {
    const shown = update(Msg.cases.PreviewLoaded.make({ config: previewed }), loaded);

    expect(shown.cmds).toEqual([apply(previewed)]);
  });

  test("a save during a preview is kept, not applied over it", () => {
    const shown = update(Msg.cases.PreviewLoaded.make({ config: previewed }), loaded).model;

    const saved = update(
      Msg.cases.ConfigLoaded.make({ config: onDisk, problems: [], recipes }),
      shown,
    );

    expect(saved.cmds).toEqual([]);
    expect(saved.model.loaded).toEqual(onDisk);

    const ended = update(Msg.cases.PreviewEnded.make({ saved: false }), saved.model);

    expect(ended.model.preview).toBeNull();
    expect(ended.cmds).toEqual([apply(onDisk)]);
  });

  test("a saved preview stays up until the files are read back", () => {
    const shown = update(Msg.cases.PreviewLoaded.make({ config: previewed }), loaded).model;
    const saved = update(Msg.cases.PreviewEnded.make({ saved: true }), shown);

    expect(saved.cmds).toEqual([]);

    const reread = update(
      Msg.cases.ConfigLoaded.make({ config: previewed, problems: [], recipes }),
      saved.model,
    );

    expect(reread.model.preview).toBeNull();
    expect(reread.cmds).toEqual([apply(previewed)]);
  });

  test("ending no preview does nothing", () => {
    expect(update(Msg.cases.PreviewEnded.make({ saved: false }), loaded).cmds).toEqual([]);
  });
});
