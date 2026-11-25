import { Schema } from "effect";
import type { Mode } from "../shared/schema/browser";
import type { CompletionCandidate } from "../shared/schema/completion";
import type { InputMode } from "../shared/schema/config";
import { type KeyTable, MODAL_TABLES } from "../shared/schema/keymap";
import type { Action, Actions } from "./actions";

/** A default key: its notation, or that with the argument it passes and a platform it skips. */
type KeySpec =
  | string
  | { readonly key: string; readonly arg?: string; readonly not?: NodeJS.Platform };

/** A command's default keys in each built-in preset. Vim keys are modal; standard keys are chords. */
interface DefaultKeys {
  readonly vim?: Partial<Record<Exclude<KeyTable, "chords">, ReadonlyArray<KeySpec>>>;
  readonly standard?: ReadonlyArray<KeySpec>;
}

interface CommandSpec {
  run: (actions: Actions) => Action;
  /** One line saying what it does. */
  description: string;
  /** The mode it leaves behind. Normal unless it opens something to type into. */
  enter?: Mode;
  /** Shown beside the command while completing, e.g. `<level>`; brackets mark it optional. */
  arg?: string;
  /** Needs a mode a `:` line cannot leave it in, so completion does not offer it. */
  keybindOnly?: true;
  /** The engine supplies its argument, so no key can be bound to it. */
  bindable?: false;
  keys?: DefaultKeys;
}

const isNotation = Schema.is(Schema.String);

const TAB_POSITIONS = ["1", "2", "3", "4", "5", "6", "7", "8"];

/**
 * Every command Kvist has: the action each runs and the keys it has by
 * default. Names are not derived from actions: a command name is Kvist's
 * published surface, so renaming a method must not rename a command.
 */
const COMMANDS = {
  "tab.new": {
    run: (a) => a.tabs.create,
    description: "Open a new tab",
    arg: "[url]",
    keys: { vim: { normal: ["t"] }, standard: ["Mod+T"] },
  },
  "tab.close": {
    run: (a) => a.tabs.close,
    description: "Close the active tab",
    keys: { vim: { normal: ["x"] }, standard: ["Mod+W"] },
  },
  "tab.reopen": {
    run: (a) => a.tabs.reopen,
    description: "Reopen the last closed tab",
    keys: { vim: { normal: ["X"] }, standard: ["Mod+Shift+T"] },
  },
  "tab.next": {
    run: (a) => a.tabs.next,
    description: "Go to the next tab",
    keys: { vim: { normal: ["gt"] }, standard: ["Ctrl+Tab"] },
  },
  "tab.prev": {
    run: (a) => a.tabs.prev,
    description: "Go to the previous tab",
    keys: { vim: { normal: ["gT"] }, standard: ["Ctrl+Shift+Tab"] },
  },
  "tab.select": {
    run: (a) => a.tabs.select,
    description: "Go to tab n, or the last tab",
    arg: "<n|last>",
    keys: {
      standard: [
        ...TAB_POSITIONS.map((n) => ({ key: `Mod+${n}`, arg: n })),
        { key: "Mod+9", arg: "last" },
      ],
    },
  },

  "nav.back": {
    run: (a) => a.nav.back,
    description: "Go back",
    // Alt+Left moves by word in a macOS text field, and chords apply while typing.
    keys: { vim: { normal: ["H"] }, standard: ["Mod+[", { key: "Alt+ArrowLeft", not: "darwin" }] },
  },
  "nav.forward": {
    run: (a) => a.nav.forward,
    description: "Go forward",
    keys: {
      vim: { normal: ["L"] },
      standard: ["Mod+]", { key: "Alt+ArrowRight", not: "darwin" }],
    },
  },
  "nav.reload": {
    run: (a) => a.nav.reload,
    description: "Reload the page",
    keys: { vim: { normal: ["r"] }, standard: ["Mod+R", "F5"] },
  },
  "nav.open": { run: (a) => a.nav.open, description: "Open a URL in the active tab", arg: "<url>" },

  "scroll.down": {
    run: (a) => a.scroll.down,
    description: "Scroll down",
    keys: { vim: { normal: ["j"] } },
  },
  "scroll.up": {
    run: (a) => a.scroll.up,
    description: "Scroll up",
    keys: { vim: { normal: ["k"] } },
  },
  "scroll.half-down": {
    run: (a) => a.scroll.halfDown,
    description: "Scroll half a screen down",
    keys: { vim: { normal: ["d"] } },
  },
  "scroll.half-up": {
    run: (a) => a.scroll.halfUp,
    description: "Scroll half a screen up",
    keys: { vim: { normal: ["u"] } },
  },
  "scroll.top": {
    run: (a) => a.scroll.top,
    description: "Scroll to the top",
    keys: { vim: { normal: ["gg"] } },
  },
  "scroll.bottom": {
    run: (a) => a.scroll.bottom,
    description: "Scroll to the bottom",
    keys: { vim: { normal: ["G"] } },
  },

  "find.open": {
    run: (a) => a.focus.chrome,
    description: "Search the page",
    enter: "find",
    keybindOnly: true,
    keys: { vim: { normal: ["/"] }, standard: ["Mod+F"] },
  },
  "find.next": {
    run: (a) => a.find.next,
    description: "Go to the next match",
    keys: { vim: { normal: ["n"] }, standard: ["Mod+G"] },
  },
  "find.prev": {
    run: (a) => a.find.prev,
    description: "Go to the previous match",
    keys: { vim: { normal: ["N"] }, standard: ["Mod+Shift+G"] },
  },
  "find.clear": {
    run: (a) => a.find.clear,
    description: "Clear the match highlighting",
    keys: { vim: { normal: ["<Esc>"] } },
  },

  "hints.show": {
    run: (a) => a.hints.show,
    description: "Label every link on screen",
    enter: "hint",
    keybindOnly: true,
    keys: { vim: { normal: ["f"] } },
  },
  "hints.hide": {
    run: (a) => a.hints.hide,
    description: "Give up hinting",
    enter: "normal",
    keybindOnly: true,
    keys: { vim: { hint: ["<Esc>"] } },
  },
  "hints.key": {
    run: (a) => a.hints.key,
    description: "Type a key of a hint label",
    keybindOnly: true,
    bindable: false,
  },

  "focus.page": {
    run: (a) => a.focus.page,
    description: "Give the keyboard to the page",
    keybindOnly: true,
  },
  "focus.chrome": {
    run: (a) => a.focus.chrome,
    description: "Give the keyboard to the chrome",
    keybindOnly: true,
  },
  "focus.omnibox": {
    run: (a) => a.focus.omnibox,
    description: "Type in the omnibox",
    enter: "insert",
    keybindOnly: true,
    keys: { vim: { normal: ["o"] }, standard: ["Mod+L"] },
  },
  "cmdline.open": {
    run: (a) => a.cmdline.open,
    description: "Open the command line",
    enter: "command",
    keybindOnly: true,
    keys: { vim: { normal: [":"] }, standard: ["Mod+Shift+P"] },
  },

  "insert.enter": {
    run: (a) => a.insert.enter,
    description: "Hand every key to the page",
    enter: "insert",
    keybindOnly: true,
    keys: { vim: { normal: ["i"] } },
  },
  "insert.leave": {
    run: (a) => a.insert.leave,
    description: "Take the keyboard back from the page",
    enter: "normal",
    keybindOnly: true,
    keys: { vim: { insert: ["<Esc>"] } },
  },

  "downloads.toggle": {
    run: (a) => a.downloads.toggle,
    description: "Keep the downloads panel open, or let it go",
    keys: { standard: ["Mod+J"] },
  },
  "downloads.clear": {
    run: (a) => a.downloads.clear,
    description: "Forget the downloads that have finished",
  },
  "downloads.cancel": {
    run: (a) => a.downloads.cancel,
    description: "Stop row n, or the newest live transfer",
    arg: "[n]",
  },

  // No alias: a short form that forgot its argument would answer the wrong
  // way, and these exist for the prompt-mode keys rather than for typing.
  // No `enter` either: the mode outlives one answer while another question waits.
  "prompt.allow": {
    run: (a) => a.prompts.allow,
    description: "Allow what the page asked for",
    keybindOnly: true,
    keys: { vim: { prompt: ["y"] } },
  },
  "prompt.deny": {
    run: (a) => a.prompts.deny,
    description: "Deny what the page asked for",
    keybindOnly: true,
    keys: { vim: { prompt: ["n", "<Esc>"] } },
  },

  "clipboard.yank": {
    run: (a) => a.clipboard.yank,
    description: "Copy the page URL",
    keys: { vim: { normal: ["y"] } },
  },
  "clipboard.open": {
    run: (a) => a.clipboard.open,
    description: "Open the copied URL",
    keys: { vim: { normal: ["p"] } },
  },
  "clipboard.openNewTab": {
    run: (a) => a.clipboard.openNewTab,
    description: "Open the copied URL in a new tab",
    keys: { vim: { normal: ["P"] } },
  },

  "style.open": {
    run: (a) => a.style.open,
    description: "Open the style files that apply to this page",
  },

  "recipe.use": {
    run: (a) => a.recipe.use,
    description: "Switch recipe, or show the current one",
    arg: "[name]",
  },

  "bookmark.toggle": {
    run: (a) => a.bookmark.toggle,
    description: "Bookmark the page, or remove it",
    keys: { vim: { normal: ["B"] }, standard: ["Mod+D"] },
  },
  "bookmarks.open": {
    run: (a) => a.bookmark.open,
    description: "Open the bookmarks panel",
    enter: "insert",
    keys: { vim: { normal: ["gb"] }, standard: ["Mod+Shift+O"] },
  },

  "zoom.in": {
    run: (a) => a.zoom.in,
    description: "Zoom in",
    keys: { vim: { normal: ["zi"] }, standard: ["Mod+=", "Mod++"] },
  },
  "zoom.out": {
    run: (a) => a.zoom.out,
    description: "Zoom out",
    keys: { vim: { normal: ["zo"] }, standard: ["Mod+-"] },
  },
  "zoom.reset": {
    run: (a) => a.zoom.reset,
    description: "Reset the zoom",
    keys: { vim: { normal: ["z0"] }, standard: ["Mod+0"] },
  },
  "zoom.set": { run: (a) => a.zoom.set, description: "Set the zoom level", arg: "<level>" },

  "app.quit": {
    run: (a) => a.app.quit,
    description: "Quit Kvist",
    keys: { standard: ["Mod+Q"] },
  },
  "app.devtools": {
    run: (a) => a.app.devtools,
    description: "Show or hide DevTools",
    keys: { standard: ["Mod+Alt+I", "F12"] },
  },
} satisfies Record<string, CommandSpec>;

/** Every name a keybind or a `:line` may use; a typo stops compiling. */
export type CommandName = keyof typeof COMMANDS;

/** The short forms a user types at the prompt. */
const ALIASES = {
  q: "tab.close",
  quit: "tab.close",
  qa: "app.quit",
  tabnew: "tab.new",
  undo: "tab.reopen",
  r: "nav.reload",
  reload: "nav.reload",
  o: "nav.open",
  open: "nav.open",
  downloads: "downloads.toggle",
  devtools: "app.devtools",
  // `:zoom` reads more naturally than `:zoom.in` for the common cases.
  zi: "zoom.in",
  zo: "zoom.out",
  z0: "zoom.reset",
  zoom: "zoom.set",
  style: "style.open",
  recipe: "recipe.use",
  bookmark: "bookmark.toggle",
  bookmarks: "bookmarks.open",
} satisfies Record<string, CommandName>;

// Maps, not records: a record lookup would find `toString` and every
// other inherited member.
const specs = new Map<string, CommandSpec>(Object.entries(COMMANDS));
const aliases = new Map<string, CommandName>(Object.entries(ALIASES));

// SAFETY: Object.entries widens the keys of COMMANDS, which are exactly the CommandNames.
const commandEntries = Object.entries(COMMANDS) as Array<[CommandName, CommandSpec]>;

export interface Commands {
  /** Runs a command by name or alias. False when there is no such command. */
  execute(nameOrAlias: string, arg?: string): boolean;
}

export function createCommands(actions: Actions): Commands {
  const commands = new Map([...specs].map(([name, spec]) => [name, spec.run(actions)]));

  return {
    execute(nameOrAlias, arg) {
      const run = commands.get(nameOrAlias) ?? commands.get(aliases.get(nameOrAlias) ?? "");

      if (!run) return false;
      run(arg);

      return true;
    },
  };
}

/** The mode a typed `:` line leaves behind once it has run. */
export function modeAfter(line: string): Mode {
  const [word = ""] = line.trim().split(/\s+/);
  const spec = specs.get(specs.has(word) ? word : (aliases.get(word) ?? ""));

  return (spec?.keybindOnly ? undefined : spec?.enter) ?? "normal";
}

/** A key's default, as the registry lists it for one preset. */
export interface DefaultKey {
  readonly table: KeyTable;
  readonly notation: string;
  readonly command: CommandName;
  readonly arg?: string;
}

/** Every default key of a built-in preset, in registry order. */
export function defaultKeys(engine: InputMode, platform: NodeJS.Platform): DefaultKey[] {
  const tables = (
    keys: DefaultKeys = {},
  ): ReadonlyArray<readonly [KeyTable, ReadonlyArray<KeySpec>]> =>
    engine === "standard"
      ? [["chords", keys.standard ?? []]]
      : MODAL_TABLES.map((table) => [table, keys.vim?.[table] ?? []]);

  return commandEntries.flatMap(([command, spec]) =>
    tables(spec.keys).flatMap(([table, list]) =>
      list.flatMap((key): DefaultKey[] => {
        if (isNotation(key)) return [{ table, command, notation: key }];

        if (key.not === platform) return [];
        const arg = key.arg === undefined ? {} : { arg: key.arg };

        return [{ table, command, notation: key.key, ...arg }];
      }),
    ),
  );
}

/** What a key needs to know of the command it runs. */
export interface BindableCommand {
  readonly name: CommandName;
  readonly enter?: Mode;
}

/**
 * The command a binding names, by name or alias. `"unbindable"` for one whose
 * argument only the engine can supply.
 */
export function bindableCommand(nameOrAlias: string): BindableCommand | "unbindable" | undefined {
  const found = commandEntries.find(
    ([name]) => name === nameOrAlias || name === aliases.get(nameOrAlias),
  );

  if (found === undefined) return undefined;
  const [name, spec] = found;

  if (spec.bindable === false) return "unbindable";

  return spec.enter === undefined ? { name } : { name, enter: spec.enter };
}

/** Every command with what it does, for listing them. */
export function describeCommands(): ReadonlyArray<{
  readonly name: string;
  readonly description: string;
  readonly bindable: boolean;
}> {
  return commandEntries.map(([name, spec]) => ({
    name,
    description: spec.description,
    bindable: spec.bindable !== false,
  }));
}

function withArg(name: string, arg: string | undefined): string {
  return arg === undefined ? name : `${name} ${arg}`;
}

/**
 * What a `:` line could be completing into, aliases first. Only the command
 * word is completed; once the line has an argument there is nothing to offer.
 */
export function completeCommand(line: string): CompletionCandidate[] {
  const word = line.trimStart();

  if (word === "" || /\s/.test(word)) return [];
  const prefix = word.toLowerCase();
  const matches = (name: string): boolean => name.toLowerCase().startsWith(prefix);

  const fromAliases = [...aliases].flatMap(([alias, name]): CompletionCandidate[] =>
    matches(alias)
      ? [{ label: alias, value: alias, kind: "alias", hint: withArg(name, specs.get(name)?.arg) }]
      : [],
  );

  // A missing hint is a missing key: the wire schema rejects `hint: undefined`.
  const fromCommands = [...specs].flatMap(([name, spec]): CompletionCandidate[] =>
    !spec.keybindOnly && matches(name)
      ? [{ label: name, value: name, kind: "command", ...(spec.arg && { hint: spec.arg }) }]
      : [],
  );

  return [...fromAliases, ...fromCommands];
}
