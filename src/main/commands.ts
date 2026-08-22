import type { Action, Actions } from "./actions";

/**
 * Every command Kvist has, and the action each one runs. Names are written out
 * rather than derived from the actions they point at: a command name is the
 * closest thing Kvist has to a published surface — keybinds use it, `:lines`
 * use it, and user keybinds will — so renaming a method must not rename a
 * command under a user's config.
 */
function table(actions: Actions) {
  return {
    "tab.new": actions.tabs.create,
    "tab.close": actions.tabs.close,
    "tab.next": actions.tabs.next,
    "tab.prev": actions.tabs.prev,

    "nav.back": actions.nav.back,
    "nav.forward": actions.nav.forward,
    "nav.reload": actions.nav.reload,
    "nav.open": actions.nav.open,

    "scroll.down": actions.scroll.down,
    "scroll.up": actions.scroll.up,
    "scroll.half-down": actions.scroll.halfDown,
    "scroll.half-up": actions.scroll.halfUp,
    "scroll.top": actions.scroll.top,
    "scroll.bottom": actions.scroll.bottom,

    "find.next": actions.find.next,
    "find.prev": actions.find.prev,
    "find.clear": actions.find.clear,

    "hints.show": actions.hints.show,
    "hints.hide": actions.hints.hide,
    "hints.key": actions.hints.key,

    "focus.page": actions.focus.page,
    "focus.chrome": actions.focus.chrome,
    "focus.omnibox": actions.focus.omnibox,

    "insert.leave": actions.insert.leave,

    "downloads.toggle": actions.downloads.toggle,
    "downloads.clear": actions.downloads.clear,
    "downloads.cancel": actions.downloads.cancel,

    "app.quit": actions.app.quit,
    "app.devtools": actions.app.devtools,
  };
}

/** Every name a keybind or a `:line` may use; a typo stops compiling. */
export type CommandName = keyof ReturnType<typeof table>;

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
} satisfies Record<string, CommandName>;

export interface Commands {
  /** Runs a command by name or alias. False when there is no such command. */
  execute(nameOrAlias: string, arg?: string): boolean;
}

/**
 * Own properties only. Every object inherits `toString`, `valueOf` and
 * `constructor`, and none of those is a command a user may run.
 */
function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function createCommands(actions: Actions): Commands {
  const commands: Record<string, Action> = table(actions);
  // ALIASES already carries a `satisfies` against CommandName; keep inference.
  const aliases = ALIASES;

  return {
    execute(nameOrAlias, arg) {
      const alias = own(aliases, nameOrAlias) ?? nameOrAlias;
      const run = own(commands, nameOrAlias) ?? own(commands, alias);
      if (!run) return false;
      run(arg);
      return true;
    },
  };
}
