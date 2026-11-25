import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { Mode } from "../../../shared/schema/browser";
import type { Next } from "../../../shared/tea/program";
import type { Binding } from "../../../shared/schema/keymap";
import { buildKeymap } from "./keymap";
import {
  Cmd,
  init,
  type KeyInput,
  type KeySource,
  type Model,
  Msg,
  resolveKey,
  step,
  stepStandard,
  update,
} from "./vim.program";

/**
 * The program driven through the shape the old `Vim` class had, so each
 * case below reads as before: commands come out of Cmds, mode changes out
 * of the model.
 */
class Vim {
  #model: Model;
  readonly #execute: (name: string, arg?: string) => void;
  readonly #onMode: (mode: Mode) => void;

  constructor(
    keymap: ReadonlyArray<Binding>,
    execute: (name: string, arg?: string) => void,
    onMode: (mode: Mode) => void,
  ) {
    this.#model = { ...init, keymap };
    this.#execute = execute;
    this.#onMode = onMode;
  }

  get mode(): Mode {
    return this.#model.mode;
  }

  #apply(result: { readonly model: Model; readonly cmds: ReadonlyArray<Cmd> }): void {
    const before = this.#model.mode;

    this.#model = result.model;

    for (const { name, arg } of result.cmds) {
      if (arg === undefined) this.#execute(name);
      else this.#execute(name, arg);
    }

    if (this.#model.mode !== before) this.#onMode(this.#model.mode);
  }

  #send(msg: Msg): void {
    const result: Next<Model, unknown, Cmd> = update(msg, this.#model);

    this.#apply(result);
  }

  handleKey(input: KeyInput, source: KeySource): boolean {
    const stepped = step(this.#model, input, source);

    this.#apply(stepped);

    return stepped.consumed;
  }

  setPromptPending(pending: boolean): void {
    this.#send(Msg.cases.PromptPendingChanged.make({ pending }));
  }

  requestMode(mode: Mode): void {
    this.#send(Msg.cases.ModeRequested.make({ mode }));
  }

  setEditable(editable: boolean): void {
    this.#send(Msg.cases.EditableChanged.make({ editable }));
  }

  endHints(): void {
    this.#send(Msg.cases.HintsEnded.make({}));
  }
}

let execute: ReturnType<typeof vi.fn<(name: string, arg?: string) => void>>;
let vim: Vim;
let modes: Mode[];

const from =
  (source: KeySource) =>
  (k: string, modifiers: Partial<KeyInput> = {}): boolean =>
    vim.handleKey(
      { key: k, code: "", control: false, alt: false, meta: false, shift: false, ...modifiers },
      source,
    );

const key = from("page");
const chromeKey = from("chrome");

beforeEach(() => {
  execute = vi.fn();
  modes = [];
  vim = new Vim(init.keymap, execute, (mode) => modes.push(mode));
});

test("starts in normal mode", () => {
  expect(vim.mode).toBe("normal");
});

test("gt and gT step through tabs", () => {
  expect(key("g")).toBe(true);
  expect(key("t")).toBe(true);
  expect(execute).toHaveBeenCalledWith("tab.next");

  key("g");
  key("T");
  expect(execute).toHaveBeenCalledWith("tab.prev");
});

test("t alone opens a tab rather than continuing a g sequence", () => {
  expect(key("t")).toBe(true);
  expect(execute).toHaveBeenCalledWith("tab.new");
  expect(execute).not.toHaveBeenCalledWith("tab.next");
});

test("an unknown g sequence is swallowed, not leaked to the page", () => {
  key("g");
  expect(key("z")).toBe(true);
  expect(execute).not.toHaveBeenCalledWith("tab.next");
});

test("Escape clears a pending prefix", () => {
  key("g");
  key("Escape");
  // Escape after g is swallowed as an unknown sequence, find.clear is NOT run
  expect(execute).not.toHaveBeenCalledWith("find.clear");
  key("t");
  expect(execute).toHaveBeenCalledWith("tab.new");
  expect(execute).not.toHaveBeenCalledWith("tab.next");
});

test("unbound keys pass through to the page", () => {
  expect(key("q")).toBe(false);
});

test("modified keys nothing is bound to pass through, so page shortcuts still work", () => {
  expect(key("t", { control: true })).toBe(false);
  expect(execute).not.toHaveBeenCalled();
});

test("insert mode passes keys through and Escape returns to normal", () => {
  key("i");
  expect(vim.mode).toBe("insert");
  expect(execute.mock.calls).toEqual([["insert.enter"]]);

  expect(key("t")).toBe(false);
  expect(execute).not.toHaveBeenCalledWith("tab.new");

  expect(key("Escape")).toBe(true);
  expect(vim.mode).toBe("normal");
  expect(execute).toHaveBeenCalledWith("insert.leave");
});

test("o focuses the omnibox and enters insert", () => {
  key("o");
  expect(execute).toHaveBeenCalledWith("focus.omnibox");
  expect(vim.mode).toBe("insert");
});

test("gb opens the bookmarks panel and enters insert, so its filter gets the keys", () => {
  key("g");
  key("b");
  expect(execute).toHaveBeenCalledWith("bookmarks.open");
  expect(vim.mode).toBe("insert");
});

test("colon enters command mode and opens a command line", () => {
  key(":");
  expect(vim.mode).toBe("command");
  expect(execute).toHaveBeenCalledWith("cmdline.open");
});

test("command mode leaves keys to the chrome", () => {
  key(":");
  expect(key("t")).toBe(false);
  expect(execute).not.toHaveBeenCalledWith("tab.new");
});

test("returning to normal from the chrome refocuses the page", () => {
  key(":");
  vim.requestMode("normal");
  expect(vim.mode).toBe("normal");
  expect(execute).toHaveBeenCalledWith("focus.page");
});

test("mode changes are broadcast once each", () => {
  key("i");
  key("Escape");
  expect(modes).toEqual(["insert", "normal"]);
});

test("navigation keys are bound", () => {
  key("H");
  key("L");
  key("r");
  key("x");
  expect(execute).toHaveBeenCalledWith("nav.back");
  expect(execute).toHaveBeenCalledWith("nav.forward");
  expect(execute).toHaveBeenCalledWith("nav.reload");
  expect(execute).toHaveBeenCalledWith("tab.close");
});

test("zoom keys are bound in normal mode only", () => {
  for (const sequence of ["zi", "zo", "z0"]) {
    for (const k of sequence) key(k);
  }

  expect(execute.mock.calls).toEqual([["zoom.in"], ["zoom.out"], ["zoom.reset"]]);
});

test("B toggles the bookmark in normal mode, and b does not", () => {
  key("b");
  key("B");
  expect(execute.mock.calls).toEqual([["bookmark.toggle"]]);
});

test("z alone is a prefix and does not execute", () => {
  expect(key("z")).toBe(true);
  expect(execute).not.toHaveBeenCalled();
});

test("z in insert mode is not a binding", () => {
  key("i");
  expect(key("z")).toBe(false);
  expect(key("z"));
  expect(key("i")).toBe(false);
  expect(execute).not.toHaveBeenCalledWith("zoom.in");
});

test("chrome keys drive normal mode, so focus on the chrome is not a dead end", () => {
  expect(chromeKey("t")).toBe(true);
  expect(execute).toHaveBeenCalledWith("tab.new");
});

test("chrome prefixes work across sources", () => {
  chromeKey("g");
  expect(chromeKey("t")).toBe(true);
  expect(execute).toHaveBeenCalledWith("tab.next");
});

test("insert mode lets the chrome type, including its own Escape", () => {
  key("i");
  expect(chromeKey("t")).toBe(false);
  expect(chromeKey("Escape")).toBe(false);
  expect(vim.mode).toBe("insert");
  expect(execute).not.toHaveBeenCalledWith("tab.new");
});

test("command mode lets the command line type", () => {
  key(":");
  expect(chromeKey("q")).toBe(false);
  expect(chromeKey("Escape")).toBe(false);
  expect(execute).not.toHaveBeenCalledWith("tab.close");
});

test("modified chrome keys pass through", () => {
  expect(chromeKey("t", { meta: true })).toBe(false);
  expect(execute).not.toHaveBeenCalled();
});

test("focusing a text field on the page enters insert", () => {
  vim.setEditable(true);
  expect(vim.mode).toBe("insert");
  expect(key("t")).toBe(false);
  expect(execute).not.toHaveBeenCalledWith("tab.new");
});

test("leaving a text field returns to normal", () => {
  vim.setEditable(true);
  vim.setEditable(false);
  expect(vim.mode).toBe("normal");
  expect(modes).toEqual(["insert", "normal"]);
});

test("a page text field does not steal the command line", () => {
  key(":");
  vim.setEditable(true);
  expect(vim.mode).toBe("command");
});

test("Escape blurs the field, so normal mode actually gets the keyboard back", () => {
  vim.setEditable(true);
  expect(key("Escape")).toBe(true);
  expect(execute).toHaveBeenCalledWith("insert.leave");
  expect(vim.mode).toBe("normal");
});

test("a field losing focus while already normal changes nothing", () => {
  vim.setEditable(false);
  expect(vim.mode).toBe("normal");
  expect(modes).toEqual([]);
});

test("scroll keys drive the page", () => {
  expect(key("j")).toBe(true);
  expect(key("k")).toBe(true);
  expect(key("d")).toBe(true);
  expect(key("u")).toBe(true);
  expect(key("G")).toBe(true);
  expect(execute.mock.calls).toEqual([
    ["scroll.down"],
    ["scroll.up"],
    ["scroll.half-down"],
    ["scroll.half-up"],
    ["scroll.bottom"],
  ]);
});

test("gg scrolls to the top", () => {
  key("g");
  expect(key("g")).toBe(true);
  expect(execute).toHaveBeenCalledWith("scroll.top");
});

test("scroll keys stay out of a text field", () => {
  vim.setEditable(true);
  expect(key("j")).toBe(false);
  expect(execute).not.toHaveBeenCalledWith("scroll.down");
});

test("f shows hints and enters hint mode", () => {
  expect(key("f")).toBe(true);
  expect(execute).toHaveBeenCalledWith("hints.show");
  expect(vim.mode).toBe("hint");
});

test("hint mode forwards every key to the page", () => {
  key("f");
  execute.mockClear();

  expect(key("a")).toBe(true);
  expect(key("t")).toBe(true);
  expect(execute.mock.calls).toEqual([
    ["hints.key", "a"],
    ["hints.key", "t"],
  ]);
  // t must not have opened a tab on the way past.
  expect(execute).not.toHaveBeenCalledWith("tab.new");
});

test("hint mode swallows chrome keys too", () => {
  key("f");
  execute.mockClear();

  expect(chromeKey("a")).toBe(true);
  expect(execute).toHaveBeenCalledWith("hints.key", "a");
});

test("Escape leaves hint mode and clears the labels", () => {
  key("f");
  expect(key("Escape")).toBe(true);
  expect(execute).toHaveBeenCalledWith("hints.hide");
  expect(vim.mode).toBe("normal");
});

test("the page reporting hints finished returns to normal", () => {
  key("f");
  vim.endHints();
  expect(vim.mode).toBe("normal");
});

test("slash opens the find prompt and moves focus to the chrome", () => {
  key("/");
  expect(vim.mode).toBe("find");
  expect(execute).toHaveBeenCalledWith("find.open");
});

test("find mode leaves keys to the prompt, from either source", () => {
  key("/");
  expect(key("t")).toBe(false);
  expect(chromeKey("t")).toBe(false);
  expect(chromeKey("Escape")).toBe(false);
  expect(execute).not.toHaveBeenCalledWith("tab.new");
});

test("a page text field does not steal the find prompt", () => {
  key("/");
  vim.setEditable(true);
  expect(vim.mode).toBe("find");
});

test("n and N cycle matches once the prompt is gone", () => {
  key("/");
  vim.requestMode("normal");
  execute.mockClear();

  expect(key("n")).toBe(true);
  expect(key("N")).toBe(true);
  expect(execute.mock.calls).toEqual([["find.next"], ["find.prev"]]);
});

test("Escape in normal mode clears the match highlighting", () => {
  key("Escape");
  expect(execute).toHaveBeenCalledWith("find.clear");
});

test("selecting a field keeps insert rather than snapping back to normal", () => {
  key("f");
  // Focus lands on the hinted input before the page reports hinting is over.
  vim.setEditable(true);
  vim.endHints();
  expect(vim.mode).toBe("insert");
});

test("a pending permission question captures normal mode", () => {
  vim.setPromptPending(true);
  expect(vim.mode).toBe("prompt");
  expect(modes).toEqual(["prompt"]);
});

test("y, n and Escape answer the question", () => {
  vim.setPromptPending(true);

  expect(key("y")).toBe(true);
  expect(execute).toHaveBeenCalledWith("prompt.allow");

  expect(key("n")).toBe(true);
  expect(execute).toHaveBeenCalledWith("prompt.deny");

  expect(key("Escape")).toBe(true);
  expect(execute).toHaveBeenCalledWith("prompt.deny");
  // No command runs focus.page or the like: the mode outlives one answer
  // while the queue has another question behind it.
  expect(vim.mode).toBe("prompt");
});

test("prompt mode swallows every other key, from either source", () => {
  vim.setPromptPending(true);

  expect(key("j")).toBe(true);
  expect(chromeKey("t")).toBe(true);
  expect(execute).not.toHaveBeenCalledWith("scroll.down");
  expect(execute).not.toHaveBeenCalledWith("tab.new");
});

test("the queue draining is what hands normal back", () => {
  vim.setPromptPending(true);
  // Answered, but another question is queued behind it: still prompting.
  vim.setPromptPending(true);
  expect(vim.mode).toBe("prompt");

  vim.setPromptPending(false);
  expect(vim.mode).toBe("normal");
  expect(modes).toEqual(["prompt", "normal"]);
});

test("a question arriving mid-typing waits, and catches the way back through normal", () => {
  key("i");
  expect(vim.mode).toBe("insert");

  vim.setPromptPending(true);
  expect(vim.mode).toBe("insert");

  // Leaving insert heads for normal, and the pending question intercepts it.
  key("Escape");
  expect(vim.mode).toBe("prompt");
});

test("a question arriving at the command line does not take its keys", () => {
  key(":");
  vim.setPromptPending(true);
  expect(vim.mode).toBe("command");
  expect(chromeKey("y")).toBe(false);
  expect(execute).not.toHaveBeenCalledWith("prompt.allow");

  // Escaping the command line lands on the prompt, not on normal.
  vim.requestMode("normal");
  expect(vim.mode).toBe("prompt");
});

test("a page text field does not steal the permission prompt", () => {
  vim.setPromptPending(true);
  vim.setEditable(true);
  expect(vim.mode).toBe("prompt");
});

test("a chrome input closing leaves its typing mode without moving focus", () => {
  for (const mode of ["insert", "command"] as const) {
    const closed = update(Msg.cases.ChromeInputClosed.make({}), { ...init, mode });

    expect(closed.model.mode).toBe("normal");
    expect(closed.cmds).toEqual([]);
  }

  const hinting = { ...init, mode: "hint" as const };

  expect(update(Msg.cases.ChromeInputClosed.make({}), hinting).model).toBe(hinting);
  expect(
    update(Msg.cases.ChromeInputClosed.make({}), { ...init, mode: "insert", promptPending: true })
      .model.mode,
  ).toBe("prompt");
});

/** The vim preset with config.toml's `[keys]` over it. */
const vimWith = (toml: Record<string, Record<string, string>>): Model => ({
  ...init,
  keymap: buildKeymap("vim", [{ keys: toml }], "linux").bindings,
});

const press = (k: string, modifiers: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  code: "",
  control: false,
  alt: false,
  meta: false,
  shift: false,
  ...modifiers,
});

test("a keybind's argument reaches its command", () => {
  const model = vimWith({ normal: { q: "zoom.set 2" } });

  expect(step(model, press("q"), "page").cmds).toEqual([
    Cmd.cases.RunCommand.make({ name: "zoom.set", arg: "2" }),
  ]);
});

const runs = (name: string, arg?: string) => Cmd.cases.RunCommand.make({ name, arg });

test("E is a key of its own, not the start of Escape", () => {
  expect(step(init, press("E", { shift: true }), "page")).toEqual({
    model: init,
    consumed: false,
    cmds: [],
  });
});

test("Shift pressed on the way to gT does not break the sequence", () => {
  const g = step(init, press("g"), "page");

  expect(g).toEqual({ model: { ...init, pending: [press("g")] }, consumed: true, cmds: [] });

  const shift = step(g.model, press("Shift", { shift: true }), "page");

  expect(shift).toEqual({ model: g.model, consumed: false, cmds: [] });
  expect(step(shift.model, press("T", { shift: true }), "page")).toEqual({
    model: init,
    consumed: true,
    cmds: [runs("tab.prev")],
  });
});

test("a held key nothing wants passes, and leaves a prefix waiting", () => {
  const g = step(init, press("g"), "page").model;
  const held = step(g, press("c", { control: true }), "page");

  expect(held).toEqual({ model: g, consumed: false, cmds: [] });
  expect(step(held.model, press("t"), "page")).toEqual({
    model: init,
    consumed: true,
    cmds: [runs("tab.next")],
  });
});

describe("rebound keys", () => {
  test("a modal key may be held", () => {
    const model = vimWith({ normal: { "<C-d>": "scroll.half-down" } });
    const stepped = step(model, press("d", { control: true }), "page");

    expect(stepped.consumed).toBe(true);
    expect(stepped.cmds).toEqual([
      Cmd.cases.RunCommand.make({ name: "scroll.half-down", arg: undefined }),
    ]);
  });

  test("a vim chord works in every mode and from either webContents", () => {
    const model = vimWith({ chords: { "Ctrl+Tab": "tab.next" } });
    const ctrlTab = press("Tab", { control: true });

    for (const mode of ["normal", "insert", "command", "hint", "prompt"] as const) {
      for (const source of ["page", "chrome"] as const) {
        expect(step({ ...model, mode }, ctrlTab, source).cmds.at(-1)).toEqual(runs("tab.next"));
      }
    }
  });

  test("a chord fired while hinting hides the labels and leaves hint mode", () => {
    const hinting = { ...vimWith({ chords: { "Ctrl+Tab": "tab.next" } }), mode: "hint" as const };

    const stepped = step(hinting, press("Tab", { control: true }), "page");

    expect(stepped.model.mode).toBe("normal");
    expect(stepped.cmds).toEqual([runs("hints.hide"), runs("tab.next")]);
  });

  test("a chord that enters a mode from hint mode hides the labels once", () => {
    const hinting = {
      ...vimWith({ chords: { "Ctrl+L": "focus.omnibox", "Ctrl+H": "hints.hide" } }),
      mode: "hint" as const,
    };

    const omnibox = step(hinting, press("l", { control: true }), "page");

    expect(omnibox.model.mode).toBe("insert");
    expect(omnibox.cmds).toEqual([runs("hints.hide"), runs("focus.omnibox")]);
    expect(step(hinting, press("h", { control: true }), "page").cmds).toEqual([runs("hints.hide")]);
  });

  test("a chord outside hint mode keeps the mode", () => {
    const model = { ...vimWith({ chords: { "Ctrl+Tab": "tab.next" } }), mode: "insert" as const };

    expect(step(model, press("Tab", { control: true }), "page").model.mode).toBe("insert");
  });

  test("a new keymap replaces the keys and forgets a pending prefix", () => {
    const { keymap } = vimWith({ normal: { J: "tab.next" } });

    const changed = update(Msg.cases.KeymapChanged.make({ scheme: "vim", keymap }), {
      ...init,
      pending: [press("g")],
    }).model;

    expect(changed.pending).toEqual([]);
    expect(step(changed, press("J", { shift: true }), "page").cmds).toEqual([
      Cmd.cases.RunCommand.make({ name: "tab.next", arg: undefined }),
    ]);
  });
});

describe("standard mode", () => {
  const standard: Model = {
    ...init,
    scheme: "standard",
    keymap: buildKeymap("standard", [], "linux").bindings,
  };

  const modTab = press("t", { control: true });

  test("plain keys pass to the page, in every mode", () => {
    for (const mode of ["normal", "insert"] as const) {
      for (const k of ["j", "f", ":", "Escape", "/"]) {
        expect(stepStandard({ ...standard, mode }, press(k)).consumed).toBe(false);
      }
    }
  });

  test("a chord runs its command from any mode and either webContents", () => {
    for (const mode of ["normal", "insert", "command", "find"] as const) {
      const stepped = stepStandard({ ...standard, mode }, modTab);

      expect(stepped.consumed).toBe(true);
      expect(stepped.cmds).toEqual([
        Cmd.cases.RunCommand.make({ name: "tab.new", arg: undefined }),
      ]);
    }

    expect(resolveKey(standard, modTab, "page")).toBe(true);
    expect(resolveKey(standard, modTab, "chrome")).toBe(true);
    expect(resolveKey(standard, press("j"), "page")).toBe(false);
  });

  test("vim keys do nothing, and vim mode ignores chords", () => {
    expect(
      update(Msg.cases.KeyPressed.make({ ...press("t"), source: "page" }), standard).cmds,
    ).toEqual([]);
    expect(resolveKey(init, modTab, "page")).toBe(false);
  });

  test("a chord that opens an input enters its mode, and passes its argument", () => {
    expect(stepStandard(standard, press("f", { control: true })).model.mode).toBe("find");
    expect(stepStandard(standard, press("3", { control: true })).cmds).toEqual([
      Cmd.cases.RunCommand.make({ name: "tab.select", arg: "3" }),
    ]);
  });

  test("a pending question does not capture the keyboard", () => {
    const pending = update(Msg.cases.PromptPendingChanged.make({ pending: true }), standard).model;

    expect(pending).toEqual({ ...standard, promptPending: true });
    expect(resolveKey(pending, press("y"), "page")).toBe(false);
    expect(update(Msg.cases.ModeRequested.make({ mode: "normal" }), pending).model.mode).toBe(
      "normal",
    );
  });

  const switchTo = (scheme: "vim" | "standard", model: Model) =>
    update(
      Msg.cases.KeymapChanged.make({
        scheme,
        keymap: scheme === "vim" ? init.keymap : standard.keymap,
      }),
      model,
    );

  test("switching to standard hides hints and forgets a pending prefix", () => {
    const switched = switchTo("standard", { ...init, mode: "hint", pending: [press("g")] });

    expect(switched.model).toEqual({ ...standard, mode: "normal", pending: [] });
    expect(switched.cmds).toEqual([
      Cmd.cases.RunCommand.make({ name: "hints.hide", arg: undefined }),
    ]);
  });

  test("switching to standard releases a question's hold on the keyboard", () => {
    const switched = switchTo("standard", { ...init, mode: "prompt", promptPending: true });

    expect(switched.model.mode).toBe("normal");
    expect(switched.cmds).toEqual([]);
  });

  test("switching back to vim with a question waiting captures normal mode", () => {
    expect(switchTo("vim", { ...standard, promptPending: true }).model.mode).toBe("prompt");
  });

  test("a typing mode survives the switch, because focus did not move", () => {
    expect(switchTo("standard", { ...init, mode: "insert" }).model.mode).toBe("insert");
    expect(switchTo("vim", { ...standard, mode: "insert" }).model.mode).toBe("insert");
  });

  test("the same scheme keeps the mode and runs nothing", () => {
    const same = switchTo("vim", { ...init, mode: "hint" });

    expect(same.model).toEqual({ ...init, mode: "hint" });
    expect(same.cmds).toEqual([]);
  });
});
