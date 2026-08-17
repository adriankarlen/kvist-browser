import { resolveUrl } from "../shared/url";
import type { Actions } from "./actions";

export interface CommandDef {
  name: string;
  aliases?: string[];
  execute: (arg?: string) => void;
}

export class CommandRegistry {
  #handlers = new Map<string, (arg?: string) => void>();
  #aliases = new Map<string, string>();

  register(def: CommandDef): void {
    this.#handlers.set(def.name, def.execute);
    for (const alias of def.aliases ?? []) {
      this.#aliases.set(alias, def.name);
    }
  }

  /** Runs a command by name or alias. Returns false if the command is unknown. */
  execute(nameOrAlias: string, arg?: string): boolean {
    const handler =
      this.#handlers.get(nameOrAlias) ?? this.#handlers.get(this.#aliases.get(nameOrAlias) ?? "");
    if (!handler) return false;
    handler(arg);
    return true;
  }

  /** Resolves an alias to its canonical name, or undefined if unknown. */
  resolve(nameOrAlias: string): string | undefined {
    if (this.#handlers.has(nameOrAlias)) return nameOrAlias;
    const name = this.#aliases.get(nameOrAlias);
    return name !== undefined && this.#handlers.has(name) ? name : undefined;
  }
}

/** Populates a registry with every built-in command. */
export function registerCommands(api: Actions): CommandRegistry {
  const registry = new CommandRegistry();

  const r = (name: string, execute: (arg?: string) => void, aliases?: string[]): void => {
    registry.register({ name, execute, aliases });
  };

  // Tabs
  r("tab.new", (url) => api.tabs.create(url ? resolveUrl(url) : undefined), ["tabnew"]);
  r("tab.close", () => api.tabs.close(), ["q", "quit"]);
  r("tab.next", () => api.tabs.next());
  r("tab.prev", () => api.tabs.prev());

  // Navigation
  r("nav.back", () => api.nav.back());
  r("nav.forward", () => api.nav.forward());
  r("nav.reload", () => api.nav.reload(), ["r", "reload"]);
  r(
    "nav.open",
    (url) => {
      if (url) api.nav.open(resolveUrl(url));
    },
    ["o", "open"],
  );

  // Scrolling
  r("scroll.down", () => api.scroll.to("down"));
  r("scroll.up", () => api.scroll.to("up"));
  r("scroll.half-down", () => api.scroll.to("half-down"));
  r("scroll.half-up", () => api.scroll.to("half-up"));
  r("scroll.top", () => api.scroll.to("top"));
  r("scroll.bottom", () => api.scroll.to("bottom"));

  // Find
  r("find.next", () => api.find.next());
  r("find.prev", () => api.find.prev());
  r("find.clear", () => api.find.clear());

  // Hints
  r("hints.show", () => api.hints.show());
  r("hints.hide", () => api.hints.hide());
  r("hints.key", (key) => {
    if (key) api.hints.key(key);
  });

  // Focus
  r("focus.page", () => api.focus.page());
  r("focus.chrome", () => api.focus.chrome());
  r("focus.omnibox", () => api.focus.omnibox());

  // Downloads
  r("downloads.toggle", () => api.downloads.toggle(), ["downloads"]);
  r("downloads.clear", () => api.downloads.clear());
  r("downloads.cancel", (row) => api.downloads.cancel(row));

  // Mode support — compound actions the mode machine needs
  r("insert.leave", () => {
    api.focus.blurPage();
    api.focus.page();
  });

  // Application
  r("app.quit", () => api.app.quit(), ["qa"]);
  r("app.devtools", () => api.app.devtools(), ["devtools"]);

  return registry;
}
