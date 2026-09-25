import type { CompletionCandidate } from "../shared/ipc";
import type { Action, Actions } from "./actions";

interface CommandSpec {
  run: (actions: Actions) => Action;
  /** Shown beside the command while completing, e.g. `<level>`; brackets mark it optional. */
  arg?: string;
  /** Needs a mode a `:` line cannot leave it in, so completion does not offer it. */
  keybindOnly?: true;
}

/**
 * Every command Kvist has, and the action each runs. Names are not derived
 * from actions: a command name is Kvist's published surface — keybinds and
 * `:` lines use it — so renaming a method must not rename a command.
 */
const COMMANDS = {
  "tab.new": { run: (a) => a.tabs.create, arg: "[url]" },
  "tab.close": { run: (a) => a.tabs.close },
  "tab.next": { run: (a) => a.tabs.next },
  "tab.prev": { run: (a) => a.tabs.prev },

  "nav.back": { run: (a) => a.nav.back },
  "nav.forward": { run: (a) => a.nav.forward },
  "nav.reload": { run: (a) => a.nav.reload },
  "nav.open": { run: (a) => a.nav.open, arg: "<url>" },

  "scroll.down": { run: (a) => a.scroll.down },
  "scroll.up": { run: (a) => a.scroll.up },
  "scroll.half-down": { run: (a) => a.scroll.halfDown },
  "scroll.half-up": { run: (a) => a.scroll.halfUp },
  "scroll.top": { run: (a) => a.scroll.top },
  "scroll.bottom": { run: (a) => a.scroll.bottom },

  "find.next": { run: (a) => a.find.next },
  "find.prev": { run: (a) => a.find.prev },
  "find.clear": { run: (a) => a.find.clear },

  "hints.show": { run: (a) => a.hints.show, keybindOnly: true },
  "hints.hide": { run: (a) => a.hints.hide, keybindOnly: true },
  "hints.key": { run: (a) => a.hints.key, keybindOnly: true },

  "focus.page": { run: (a) => a.focus.page, keybindOnly: true },
  "focus.chrome": { run: (a) => a.focus.chrome, keybindOnly: true },
  "focus.omnibox": { run: (a) => a.focus.omnibox, keybindOnly: true },

  "insert.leave": { run: (a) => a.insert.leave, keybindOnly: true },

  "downloads.toggle": { run: (a) => a.downloads.toggle },
  "downloads.clear": { run: (a) => a.downloads.clear },
  "downloads.cancel": { run: (a) => a.downloads.cancel, arg: "[n]" },

  // No alias: a short form that forgot its argument would answer the wrong
  // way, and these exist for the prompt-mode keys rather than for typing.
  "prompt.allow": { run: (a) => a.prompts.allow, keybindOnly: true },
  "prompt.deny": { run: (a) => a.prompts.deny, keybindOnly: true },

  "clipboard.yank": { run: (a) => a.clipboard.yank },
  "clipboard.open": { run: (a) => a.clipboard.open },
  "clipboard.openNewTab": { run: (a) => a.clipboard.openNewTab },

  "style.open": { run: (a) => a.style.open },

  "zoom.in": { run: (a) => a.zoom.in },
  "zoom.out": { run: (a) => a.zoom.out },
  "zoom.reset": { run: (a) => a.zoom.reset },
  "zoom.set": { run: (a) => a.zoom.set, arg: "<level>" },

  "app.quit": { run: (a) => a.app.quit },
  "app.devtools": { run: (a) => a.app.devtools },
} satisfies Record<string, CommandSpec>;

/** Every name a keybind or a `:line` may use; a typo stops compiling. */
export type CommandName = keyof typeof COMMANDS;

/** The short forms a user types at the prompt. */
const ALIASES = {
  q: "tab.close",
  quit: "tab.close",
  qa: "app.quit",
  tabnew: "tab.new",
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
} satisfies Record<string, CommandName>;

// Maps, not records: a record lookup would find `toString` and every
// other inherited member.
const specs = new Map<string, CommandSpec>(Object.entries(COMMANDS));
const aliases = new Map<string, CommandName>(Object.entries(ALIASES));

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

  const fromAliases = [...aliases]
    .filter(([alias]) => matches(alias))
    .map(([alias, name]): CompletionCandidate => ({
      label: alias,
      value: alias,
      kind: "alias",
      hint: withArg(name, specs.get(name)?.arg),
    }));
  const fromCommands = [...specs]
    .filter(([name, spec]) => !spec.keybindOnly && matches(name))
    .map(([name, spec]): CompletionCandidate => ({
      label: name,
      value: name,
      kind: "command",
      hint: spec.arg,
    }));
  return [...fromAliases, ...fromCommands];
}
