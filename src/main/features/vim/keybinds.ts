import type { Mode } from "../../../shared/schema/browser";
import type { CommandName } from "../../commands";

export interface Keybind {
  /** The mode in which this binding is active. */
  mode: Mode;
  /** Key or key sequence, e.g. `"t"`, `"gt"`, `"Escape"`. */
  keys: string;
  /** Command to execute (omit for a pure mode transition). */
  command?: CommandName;
  /** Passed to the command, as a `:` line would. */
  arg?: string;
  /** Mode to enter after the command runs. */
  enter?: Mode;
}

export const DEFAULT_KEYBINDS: readonly Keybind[] = [
  // ── normal mode ──────────────────────────────────────────────
  { mode: "normal", keys: "t", command: "tab.new" },
  { mode: "normal", keys: "x", command: "tab.close" },
  { mode: "normal", keys: "X", command: "tab.reopen" },
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
  { mode: "normal", keys: ":", command: "cmdline.open", enter: "command" },
  { mode: "normal", keys: "y", command: "clipboard.yank" },
  { mode: "normal", keys: "p", command: "clipboard.open" },
  { mode: "normal", keys: "P", command: "clipboard.openNewTab" },
  { mode: "normal", keys: "zi", command: "zoom.in" },
  { mode: "normal", keys: "zo", command: "zoom.out" },
  { mode: "normal", keys: "z0", command: "zoom.reset" },
  { mode: "normal", keys: "B", command: "bookmark.toggle" },
  { mode: "normal", keys: "gb", command: "bookmarks.open", enter: "insert" },

  // ── insert mode ──────────────────────────────────────────────
  { mode: "insert", keys: "Escape", command: "insert.leave", enter: "normal" },

  // ── hint mode ────────────────────────────────────────────────
  { mode: "hint", keys: "Escape", command: "hints.hide", enter: "normal" },

  // ── prompt mode ──────────────────────────────────────────────
  // No `enter`: the mode outlives one answer while the queue has another
  // question behind it, so leaving is driven by the queue draining.
  { mode: "prompt", keys: "y", command: "prompt.allow" },
  { mode: "prompt", keys: "n", command: "prompt.deny" },
  { mode: "prompt", keys: "Escape", command: "prompt.deny" },
];

/** A standard-mode shortcut. Modifiers are what Electron reports, already resolved for the platform. */
export interface Chord {
  /** `KeyboardEvent.key`; a letter is stored lower-case and matched with `shift`. */
  readonly key: string;
  readonly control: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
  readonly command: CommandName;
  readonly arg?: string;
  readonly enter?: Mode;
}

export interface ChordInput {
  readonly key: string;
  readonly code: string;
  readonly control: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}

type ChordAction = Pick<Chord, "arg" | "enter">;

/**
 * Reads `"Mod+Shift+T"`. `Mod` is Cmd on macOS and Ctrl elsewhere; `Ctrl`
 * is always Ctrl. A trailing `++` names the plus key itself.
 */
function chord(spec: string, mac: boolean, command: CommandName, action: ChordAction): Chord {
  const plusKey = spec.endsWith("++");
  const parts = (plusKey ? spec.slice(0, -2) : spec).split("+");
  const key = plusKey ? "+" : (parts.pop() ?? "");
  const has = (name: string): boolean => parts.includes(name);

  return {
    key: isLetter(key) ? key.toLowerCase() : key,
    control: has("Ctrl") || (has("Mod") && !mac),
    alt: has("Alt"),
    meta: has("Mod") && mac,
    shift: has("Shift"),
    command,
    ...action,
  };
}

const isLetter = (key: string): boolean => /^[a-z]$/i.test(key);

const TAB_POSITIONS = ["1", "2", "3", "4", "5", "6", "7", "8"];

/** The shortcuts every other browser uses, for `[input] mode = "standard"`. */
export function standardKeybinds(platform: NodeJS.Platform): ReadonlyArray<Chord> {
  const mac = platform === "darwin";

  const bind = (spec: string, command: CommandName, action: ChordAction = {}): Chord =>
    chord(spec, mac, command, action);

  return [
    bind("Mod+L", "focus.omnibox", { enter: "insert" }),
    bind("Mod+T", "tab.new"),
    bind("Mod+W", "tab.close"),
    bind("Mod+Shift+T", "tab.reopen"),
    bind("Ctrl+Tab", "tab.next"),
    bind("Ctrl+Shift+Tab", "tab.prev"),
    ...TAB_POSITIONS.map((n) => bind(`Mod+${n}`, "tab.select", { arg: n })),
    bind("Mod+9", "tab.select", { arg: "last" }),
    bind("Mod+[", "nav.back"),
    bind("Mod+]", "nav.forward"),
    // Alt+Left moves by word in a macOS text field, and these chords apply while typing.
    ...(mac ? [] : [bind("Alt+ArrowLeft", "nav.back"), bind("Alt+ArrowRight", "nav.forward")]),
    bind("Mod+R", "nav.reload"),
    bind("F5", "nav.reload"),
    bind("Mod+F", "focus.chrome", { enter: "find" }),
    bind("Mod+G", "find.next"),
    bind("Mod+Shift+G", "find.prev"),
    bind("Mod+=", "zoom.in"),
    bind("Mod++", "zoom.in"),
    bind("Mod+-", "zoom.out"),
    bind("Mod+0", "zoom.reset"),
    bind("Mod+D", "bookmark.toggle"),
    bind("Mod+Shift+O", "bookmarks.open", { enter: "insert" }),
    bind("Mod+J", "downloads.toggle"),
    bind("Mod+Shift+P", "cmdline.open", { enter: "command" }),
    bind("Mod+Alt+I", "app.devtools"),
    bind("F12", "app.devtools"),
    bind("Mod+Q", "app.quit"),
  ];
}

export const STANDARD_KEYBINDS: ReadonlyArray<Chord> = standardKeybinds(process.platform);

/** A letter outside a–z, as a Cyrillic or Greek layout types. */
const isOtherScript = (key: string): boolean => /^\p{L}$/u.test(key) && !isLetter(key);

/**
 * Modifiers match exactly. A printable non-letter carries Shift in its `key`
 * (`+`, not `=`), so Shift is compared only for letters and named keys. A
 * letter matches its physical key under Alt, where macOS types another
 * character, and on non-Latin layouts.
 */
export function matchesChord(chord: Chord, input: ChordInput): boolean {
  if (input.control !== chord.control || input.alt !== chord.alt || input.meta !== chord.meta) {
    return false;
  }

  if (isLetter(chord.key)) {
    if (input.shift !== chord.shift) return false;

    const physical = input.code === `Key${chord.key.toUpperCase()}`;

    if (input.alt) return physical;

    return input.key.toLowerCase() === chord.key || (isOtherScript(input.key) && physical);
  }

  if (chord.key.length === 1) return input.key === chord.key;

  return input.shift === chord.shift && input.key === chord.key;
}

export const findChord = (chords: ReadonlyArray<Chord>, input: ChordInput): Chord | undefined =>
  chords.find((bound) => matchesChord(bound, input));
