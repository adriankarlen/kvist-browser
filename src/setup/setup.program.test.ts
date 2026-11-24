import { describe, expect, test } from "vite-plus/test";
import { SetupIntent } from "../shared/rpc/setup";
import type { SetupOptions } from "../shared/setup";
import { Cmd, init, type Model, Msg, program, stepOf } from "./setup.program";

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
  searchUrl: "https://duckduckgo.com/?q={q}",
};

function run(start: Model, ...msgs: Msg[]): { model: Model; cmds: Cmd[] } {
  let model = start;
  const cmds: Cmd[] = [];

  for (const msg of msgs) {
    const stepped = program.update(msg, model);

    model = stepped.model;
    cmds.push(...stepped.cmds);
  }

  return { model, cmds };
}

const open = (): Model => run(init, Msg.cases.Opened.make({ seq: 1, options })).model;
const nextStep = Msg.cases.NextRequested.make({});
const back = Msg.cases.BackRequested.make({});

describe("setup wizard", () => {
  test("starts on the first-run recipe as it comes", () => {
    const model = open();

    expect(stepOf(model)).toBe("recipe");
    expect(model.choices).toMatchObject({ recipe: "tui", inputMode: "vim", tabs: "top" });
  });

  test("a recipe brings its settings, but not over ones picked by hand", () => {
    const { model } = run(
      open(),
      Msg.cases.OmniboxPicked.make({ region: "floating" }),
      Msg.cases.RecipePicked.make({ id: "test" }),
    );

    expect(model.choices).toMatchObject({
      recipe: "test",
      inputMode: "standard",
      tabs: "left",
      omnibox: "floating",
    });
  });

  test("every change is sent to main to preview", () => {
    const { cmds } = run(open(), Msg.cases.TabsPicked.make({ region: "right" }));

    expect(cmds).toEqual([
      Cmd.cases.SendToMain.make({
        intent: SetupIntent.cases.ChoicesChanged.make({
          choices: { ...open().choices!, tabs: "right" },
        }),
      }),
    ]);
  });

  test("Back never loses a choice, and does nothing on the first step", () => {
    const { model } = run(
      open(),
      nextStep,
      Msg.cases.InputModePicked.make({ mode: "standard" }),
      back,
      back,
    );

    expect(stepOf(model)).toBe("recipe");
    expect(model.choices?.inputMode).toBe("standard");
  });

  test("Next on the last step finishes with the choices", () => {
    const { model, cmds } = run(open(), nextStep, nextStep, nextStep, nextStep, nextStep);

    expect(stepOf(model)).toBe("done");

    const finished = run(model, nextStep);

    expect(finished.cmds).toEqual([
      Cmd.cases.SendToMain.make({
        intent: SetupIntent.cases.Finished.make({ choices: model.choices! }),
      }),
    ]);
    expect(cmds).toEqual([]);
  });

  test("a custom search URL without {q} holds Next back and says why", () => {
    const atSearch = run(open(), nextStep, nextStep, nextStep, nextStep).model;

    expect(stepOf(atSearch)).toBe("search");

    const { model } = run(
      atSearch,
      Msg.cases.CustomSearchChosen.make({}),
      Msg.cases.SearchTyped.make({ url: "https://example.com/?s=" }),
      nextStep,
    );

    expect(stepOf(model)).toBe("search");
    expect(model.error).toMatch(/\{q\}/);
  });

  test("Skip asks main to write the default", () => {
    expect(run(open(), Msg.cases.SkipRequested.make({})).cmds).toEqual([
      Cmd.cases.SendToMain.make({ intent: SetupIntent.cases.Skipped.make({}) }),
    ]);
  });

  test("nothing finishes, skips, goes back or changes while a save is in flight", () => {
    const atInput = run(open(), nextStep).model;
    const saving = run(atInput, Msg.cases.Status.make({ saving: true, error: undefined })).model;

    const after = run(
      saving,
      Msg.cases.SkipRequested.make({}),
      back,
      Msg.cases.InputModePicked.make({ mode: "standard" }),
      Msg.cases.RecipePicked.make({ id: "test" }),
    );

    expect(after.cmds).toEqual([]);
    expect(after.model).toEqual(saving);

    const failed = run(saving, Msg.cases.Status.make({ saving: false, error: "disk full" }));

    expect(run(failed.model, back).model.step).toBe(0);
  });

  test("a new opening starts over; a replay of the same one keeps the choices", () => {
    const changed = run(open(), nextStep, Msg.cases.InputModePicked.make({ mode: "standard" }));
    const replayed = run(changed.model, Msg.cases.Opened.make({ seq: 1, options })).model;

    expect(replayed.choices?.inputMode).toBe("standard");
    expect(replayed.step).toBe(1);

    const reopened = run(changed.model, Msg.cases.Opened.make({ seq: 2, options })).model;

    expect(reopened.choices?.inputMode).toBe("vim");
    expect(reopened.step).toBe(0);
  });
});
