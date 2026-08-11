import type { Mode } from "../shared/ipc";

export interface Keybind {
  /** The mode in which this binding is active. */
  mode: Mode;
  /** Key or key sequence, e.g. `"t"`, `"gt"`, `"Escape"`. */
  keys: string;
  /** Command to execute (omit for a pure mode transition). */
  command?: string;
  /** Mode to enter after the command runs. */
  enter?: Mode;
}

export const DEFAULT_KEYBINDS: readonly Keybind[] = [
  // ── normal mode ──────────────────────────────────────────────
  { mode: "normal", keys: "t", command: "tab.new" },
  { mode: "normal", keys: "x", command: "tab.close" },
  { mode: "normal", keys: "gt", command: "tab.next" },
  { mode: "normal", keys: "gT", command: "tab.prev" },
  { mode: "normal", keys: "H", command: "nav.back" },
  { mode: "normal", keys: "L", command: "nav.forward" },
  { mode: "normal", keys: "r", command: "nav.reload" },
  { mode: "normal", keys: "j", command: "scroll.down" },
  { mode: "normal", keys: "k", command: "scroll.up" },
  { mode: "normal", keys: "d", command: "scroll.half-down" },
  { mode: "normal", keys: "u", command: "scroll.half-up" },
  { mode: "normal", keys: "G", command: "scroll.bottom" },
  { mode: "normal", keys: "gg", command: "scroll.top" },
  { mode: "normal", keys: "n", command: "find.next" },
  { mode: "normal", keys: "N", command: "find.prev" },
  { mode: "normal", keys: "Escape", command: "find.clear" },
  { mode: "normal", keys: "f", command: "hints.show", enter: "hint" },
  { mode: "normal", keys: "o", command: "focus.omnibox", enter: "insert" },
  { mode: "normal", keys: "i", enter: "insert" },
  { mode: "normal", keys: "/", command: "focus.chrome", enter: "find" },
  { mode: "normal", keys: ":", command: "focus.chrome", enter: "command" },

  // ── insert mode ──────────────────────────────────────────────
  { mode: "insert", keys: "Escape", command: "insert.leave", enter: "normal" },

  // ── hint mode ────────────────────────────────────────────────
  { mode: "hint", keys: "Escape", command: "hints.hide", enter: "normal" },
];
