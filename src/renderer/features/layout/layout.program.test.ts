import { describe, expect, test } from "vite-plus/test";
import { DEFAULT_LAYOUT, type Placement } from "../../../shared/layout";
import { init as mainInit, type Model as MainModel } from "../main/main.program";
import {
  Cmd,
  findShown,
  init,
  type Model,
  Msg,
  omniboxShown,
  PEEK_AFTER_LEAVE,
  PEEK_AFTER_SHIFT,
  statusLine,
  tabStrip,
  update,
} from "./layout.program";

const M = Msg.cases;

function run(msgs: ReadonlyArray<Msg>, model: Model = init) {
  const cmds: Cmd[] = [];

  for (const msg of msgs) {
    const result = update(msg, model);

    model = result.model;
    cmds.push(...result.cmds);
  }

  return { model, cmds };
}

const hidden = (placement: Placement): Placement => ({ ...placement, visible: false });
const autohiding: Placement = { ...DEFAULT_LAYOUT.tabs, autohide: true };
const main = (changes: Partial<MainModel>): MainModel => ({ ...mainInit, ...changes });

describe("the tab strip", () => {
  test("shows unless the layout hides it, and is gone when hidden", () => {
    expect(tabStrip(init, DEFAULT_LAYOUT.tabs)).toBe("shown");
    expect(tabStrip(init, hidden(DEFAULT_LAYOUT.tabs))).toBe("gone");
    expect(tabStrip(init, hidden(autohiding))).toBe("gone");
  });

  test("auto-hidden, it is tucked until hovered, and leaving starts a short peek", () => {
    expect(tabStrip(init, autohiding)).toBe("tucked");

    const hovered = run([M.TabStripHovered.make({})]).model;

    expect(tabStrip(hovered, autohiding)).toBe("shown");

    const left = run([M.TabStripLeft.make({})], hovered);

    expect(tabStrip(left.model, autohiding)).toBe("shown");
    expect(left.cmds).toEqual([Cmd.cases.PeekTabStrip.make({ millis: PEEK_AFTER_LEAVE })]);

    const ended = run([M.TabStripPeekEnded.make({})], left.model).model;

    expect(tabStrip(ended, autohiding)).toBe("tucked");
  });

  test("a tab change peeks, and the peek ends on its own", () => {
    const shifted = run([M.TabsShifted.make({})]);

    expect(tabStrip(shifted.model, autohiding)).toBe("shown");
    expect(shifted.cmds).toEqual([Cmd.cases.PeekTabStrip.make({ millis: PEEK_AFTER_SHIFT })]);
  });

  test("a peek ending under the pointer leaves the strip out", () => {
    const { model } = run([
      M.TabsShifted.make({}),
      M.TabStripHovered.make({}),
      M.TabStripPeekEnded.make({}),
    ]);

    expect(tabStrip(model, autohiding)).toBe("shown");
  });
});

describe("a hidden omnibox", () => {
  test("shows only while summoned", () => {
    const placement = hidden(DEFAULT_LAYOUT.omnibox);

    expect(omniboxShown(init, DEFAULT_LAYOUT.omnibox)).toBe(true);
    expect(omniboxShown(init, placement)).toBe(false);

    const summoned = run([M.OmniboxSummoned.make({})]).model;

    expect(omniboxShown(summoned, placement)).toBe(true);
    expect(omniboxShown(run([M.OmniboxDismissed.make({})], summoned).model, placement)).toBe(false);
  });
});

describe("find", () => {
  const result = { query: "a", active: 1, matches: 2 };

  test("shows while typing, and keeps its matches showing after Enter", () => {
    expect(findShown(main({}), DEFAULT_LAYOUT.find)).toBe(false);
    expect(findShown(main({ mode: "find" }), DEFAULT_LAYOUT.find)).toBe(true);
    expect(findShown(main({ findResult: result }), DEFAULT_LAYOUT.find)).toBe(true);
  });

  test("hidden, it shows only while typing", () => {
    const placement = hidden(DEFAULT_LAYOUT.find);

    expect(findShown(main({ mode: "find", findResult: result }), placement)).toBe(true);
    expect(findShown(main({ findResult: result }), placement)).toBe(false);
  });
});

describe("the status line", () => {
  const prompt = { id: 1, state: { kind: "session-restore", tabCount: 2 } } as const;

  const info = { text: "hi", level: "info" } as const;
  const error = { text: "no", level: "error" } as const;

  test("is the command line, a prompt or a message, in that order", () => {
    const status = DEFAULT_LAYOUT.status;

    expect(statusLine(main({}), status)).toBe(null);
    expect(statusLine(main({ message: info }), status)).toBe("message");
    expect(statusLine(main({ message: info, prompt }), status)).toBe("prompt");
    expect(statusLine(main({ message: info, prompt, mode: "command" }), status)).toBe("command");
  });

  test("hidden, it still shows commands, prompts and errors, but not info", () => {
    const status = hidden(DEFAULT_LAYOUT.status);

    expect(statusLine(main({ mode: "command" }), status)).toBe("command");
    expect(statusLine(main({ prompt }), status)).toBe("prompt");
    expect(statusLine(main({ message: error }), status)).toBe("message");
    expect(statusLine(main({ message: info }), status)).toBe(null);
  });
});
