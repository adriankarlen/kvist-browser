import { describe, expect, test } from "vite-plus/test";
import { DEFAULT_CONFIG, DEFAULT_SETTINGS } from "../../../shared/config";
import type { SetupChoices, SetupOptions } from "../../../shared/setup";
import { Msg as ConfigMsg } from "../config/config.program";
import { Msg as MessagesMsg } from "../messages/messages.program";
import { Msg as VimMsg } from "../vim/vim.program";
import { Cmd, init, Msg, type Model, update } from "./setup.program";

const options: SetupOptions = {
  recipes: [
    {
      id: "test",
      name: "Test",
      description: "",
      inputMode: "standard",
      omnibox: "top",
      tabs: "left",
    },
    { id: "tui", name: "tui", description: "", inputMode: "vim", omnibox: "top", tabs: "top" },
  ],
  recipe: "tui",
  omniboxRegions: ["top", "floating"],
  tabsRegions: ["top", "bottom", "left", "right"],
  densityAvailable: true,
  searchUrl: DEFAULT_SETTINGS.searchUrl,
};

const choices: SetupChoices = {
  recipe: "test",
  inputMode: "standard",
  omnibox: "floating",
  tabs: "left",
  density: "compact",
  searchUrl: DEFAULT_SETTINGS.searchUrl,
};

const opened = (): Model => {
  const first = update(Msg.cases.SetupOpened.make({}), init).model;

  return update(Msg.cases.SetupOptionsLoaded.make({ options }), first).model;
};

const toPage = VimMsg.cases.ModeRequested.make({ mode: "normal" });

describe("setup", () => {
  test("opening loads the options, and the first recipe is previewed as it comes", () => {
    const first = update(Msg.cases.SetupOpened.make({}), init);

    expect(first.model.open).toBe(true);
    expect(first.cmds).toEqual([Cmd.cases.LoadSetupOptions.make({})]);

    const loaded = update(Msg.cases.SetupOptionsLoaded.make({ options }), first.model);

    const [preview] = loaded.cmds;

    expect(preview !== undefined && Cmd.guards.PreviewSetup(preview) && preview).toMatchObject({
      files: { toml: expect.stringContaining('recipe = "tui"\n'), css: undefined },
      revision: 1,
    });
  });

  test("a change is previewed, and only the latest preview is shown", () => {
    const changed = update(Msg.cases.SetupChoicesChanged.make({ choices }), opened());
    const [preview] = changed.cmds;

    expect(preview !== undefined && Cmd.guards.PreviewSetup(preview)).toBe(true);
    expect(changed.model.revision).toBe(2);

    const stale = update(
      Msg.cases.SetupPreviewLoaded.make({ config: DEFAULT_CONFIG, revision: 1 }),
      changed.model,
    );

    expect(stale.msgs).toEqual([]);

    const latest = update(
      Msg.cases.SetupPreviewLoaded.make({ config: DEFAULT_CONFIG, revision: 2 }),
      changed.model,
    );

    expect(latest.msgs).toEqual([ConfigMsg.cases.PreviewLoaded.make({ config: DEFAULT_CONFIG })]);
  });

  test("a half-typed search URL still previews the rest", () => {
    const changed = update(
      Msg.cases.SetupChoicesChanged.make({ choices: { ...choices, searchUrl: "https://x" } }),
      opened(),
    );

    expect(changed.cmds).toHaveLength(1);
  });

  test("Finish writes the choices, then closes and hands the keyboard to the page", () => {
    const finished = update(Msg.cases.SetupFinished.make({ choices }), opened());

    expect(finished.model.saving).toBe(true);
    const [write] = finished.cmds;

    expect(write !== undefined && Cmd.guards.WriteSetup(write) && write.files).toMatchObject({
      toml: expect.stringContaining('[layout.omnibox]\nregion = "floating"'),
      css: expect.stringContaining("--kv-density: 0.85;"),
    });

    const written = update(Msg.cases.SetupWritten.make({}), finished.model);

    expect(written.model.open).toBe(false);
    expect(written.msgs).toEqual([ConfigMsg.cases.PreviewEnded.make({ saved: true }), toPage]);
  });

  test("Finish refuses bad choices and says why", () => {
    const refused = update(
      Msg.cases.SetupFinished.make({ choices: { ...choices, searchUrl: "https://x" } }),
      opened(),
    );

    expect(refused.cmds).toEqual([]);
    expect(refused.model.error).toMatch(/\{q\}/);
  });

  test("Skip writes the first-run recipe alone and drops the preview at once", () => {
    const skipped = update(Msg.cases.SetupSkipped.make({}), opened());

    expect(skipped.cmds).toEqual([
      Cmd.cases.WriteSetup.make({
        files: {
          toml: '# Written by the Kvist setup wizard. Edit it freely; Kvist reloads it on save.\nrecipe = "tui"\n',
          css: undefined,
        },
      }),
    ]);
    expect(skipped.msgs).toEqual([ConfigMsg.cases.PreviewEnded.make({ saved: false })]);
  });

  test("a failed write keeps the wizard open with the reason", () => {
    const saving = update(Msg.cases.SetupFinished.make({ choices }), opened()).model;
    const failed = update(Msg.cases.SetupNotSaved.make({ reason: "disk full" }), saving);

    expect(failed.model).toMatchObject({ open: true, saving: false, error: "disk full" });
    expect(failed.msgs).toEqual([
      MessagesMsg.cases.MessageShown.make({ message: { text: "disk full", level: "error" } }),
    ]);
  });

  test("a config.toml written meanwhile wins: the wizard closes without saving", () => {
    const saving = update(Msg.cases.SetupFinished.make({ choices }), opened()).model;
    const superseded = update(Msg.cases.SetupSuperseded.make({ reason: "exists" }), saving);

    expect(superseded.model.open).toBe(false);
    expect(superseded.msgs.slice(0, 2)).toEqual([
      ConfigMsg.cases.PreviewEnded.make({ saved: false }),
      toPage,
    ]);
  });

  test("nothing previews or saves while a save is in flight", () => {
    const saving = update(Msg.cases.SetupFinished.make({ choices }), opened()).model;

    expect(update(Msg.cases.SetupChoicesChanged.make({ choices }), saving).cmds).toEqual([]);
    expect(update(Msg.cases.SetupSkipped.make({}), saving).cmds).toEqual([]);
  });
});
