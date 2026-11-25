import type { KeyToken } from "../../../shared/schema/keymap";

/** A key as `before-input-event` reports it. */
export interface KeyInput {
  readonly key: string;
  /** The physical key, e.g. `KeyI`. macOS turns Alt+letter into another character. */
  readonly code: string;
  readonly control: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}

interface Modifiers {
  readonly control: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}

const isLetter = (key: string): boolean => /^[a-z]$/i.test(key);

const isSingle = (key: string): boolean => /^.$/su.test(key);

/** A letter outside a–z, as a Cyrillic or Greek layout types. */
const isOtherScript = (key: string): boolean => /^\p{L}$/u.test(key) && !isLetter(key);

/** Vim's names for keys, beside the `KeyboardEvent.key` names that work as they are. */
const KEY_NAMES: ReadonlyMap<string, string> = new Map([
  ["esc", "Escape"],
  ["escape", "Escape"],
  ["cr", "Enter"],
  ["enter", "Enter"],
  ["return", "Enter"],
  ["tab", "Tab"],
  ["space", " "],
  ["lt", "<"],
  ["bar", "|"],
  ["bslash", "\\"],
  ["plus", "+"],
  ["bs", "Backspace"],
  ["backspace", "Backspace"],
  ["del", "Delete"],
  ["delete", "Delete"],
  ["up", "ArrowUp"],
  ["down", "ArrowDown"],
  ["left", "ArrowLeft"],
  ["right", "ArrowRight"],
  ["home", "Home"],
  ["end", "End"],
  ["pageup", "PageUp"],
  ["pagedown", "PageDown"],
  ["insert", "Insert"],
]);

const FUNCTION_KEY = /^F([1-9]|1\d|2[0-4])$/i;

const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  "Shift",
  "Control",
  "Alt",
  "AltGraph",
  "Meta",
  "OS",
  "Super",
  "Hyper",
  "Fn",
  "CapsLock",
  "NumLock",
]);

/** The browser's names for keys that type nothing, beside the modifiers. */
const NAMED_KEYS: ReadonlySet<string> = new Set([
  ...MODIFIER_KEYS,
  "Escape",
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ContextMenu",
  "PrintScreen",
  "ScrollLock",
  "Pause",
]);

/** The `KeyboardEvent.key` a written key name means, or undefined when it names nothing. */
function keyName(name: string): string | undefined {
  if (isSingle(name)) return name;
  const known = KEY_NAMES.get(name.toLowerCase());

  if (known !== undefined) return known;

  if (FUNCTION_KEY.test(name)) return name.toUpperCase();

  return NAMED_KEYS.has(name) ? name : undefined;
}

/** Lower-cases a letter. Shift is kept only where it was written. */
function token(key: string, modifiers: Modifiers): KeyToken {
  return { ...modifiers, key: isLetter(key) ? key.toLowerCase() : key };
}

const NONE: Modifiers = { control: false, alt: false, meta: false, shift: false };

type Held = { -readonly [K in keyof Modifiers]: boolean };

/** A typed character: its case is its Shift. */
const typed = (char: string): KeyToken =>
  token(char, { ...NONE, shift: isLetter(char) && char !== char.toLowerCase() });

const VIM_MODIFIER: ReadonlyMap<string, keyof Modifiers> = new Map([
  ["c", "control"],
  ["a", "alt"],
  ["m", "alt"],
  ["d", "meta"],
  ["s", "shift"],
]);

/** `<C-S-Tab>`, `<Esc>`, `<lt>`. A lone letter between brackets is typed as written. */
function bracketed(inner: string): KeyToken | undefined {
  const [, prefix = "", name = ""] = /^((?:[camds]-)*)(.+)$/i.exec(inner) ?? [];
  const key = keyName(name);

  if (key === undefined) return undefined;

  if (prefix === "") return isSingle(key) ? typed(key) : token(key, NONE);
  const modifiers: Held = { ...NONE };

  for (const flag of prefix.toLowerCase().split("-")) {
    const held = VIM_MODIFIER.get(flag);

    if (held !== undefined) modifiers[held] = true;
  }

  return token(key, modifiers);
}

/**
 * Reads vim notation: `gt`, `G`, `<C-d>`, `<Esc>`, `g<Tab>`. Undefined when
 * any part is not a key. A literal `<` is written `<lt>`.
 */
export function parseKeys(notation: string): ReadonlyArray<KeyToken> | undefined {
  const tokens: KeyToken[] = [];
  let rest = notation;

  while (rest !== "") {
    if (rest.startsWith("<")) {
      const end = rest.indexOf(">", 2);
      const parsed = end === -1 ? undefined : bracketed(rest.slice(1, end));

      if (parsed === undefined) return undefined;
      tokens.push(parsed);
      rest = rest.slice(end + 1);
    } else {
      const [char = ""] = rest;

      tokens.push(typed(char));
      rest = rest.slice(char.length);
    }
  }

  return tokens.length === 0 ? undefined : tokens;
}

/**
 * Reads `"Mod+Shift+T"`. `Mod` is Cmd on macOS and Ctrl elsewhere; `Ctrl`
 * is always Ctrl and `Meta` is always Cmd or Super. A trailing `++` names
 * the plus key itself.
 */
export function parseChord(spec: string, platform: NodeJS.Platform): KeyToken | undefined {
  const mac = platform === "darwin";
  const plusKey = spec.endsWith("++");
  const parts = (plusKey ? spec.slice(0, -2) : spec).split("+");
  const name = plusKey ? "+" : (parts.pop() ?? "");
  const key = keyName(name);

  if (key === undefined) return undefined;
  const modifiers: Held = { ...NONE };

  for (const part of parts) {
    const flag = part.toLowerCase();

    if (flag === "mod") modifiers[mac ? "meta" : "control"] = true;
    else if (flag === "ctrl") modifiers.control = true;
    else if (flag === "alt") modifiers.alt = true;
    else if (flag === "meta") modifiers.meta = true;
    else if (flag === "shift") modifiers.shift = true;
    else return undefined;
  }

  return token(key, modifiers);
}

/** One spelling per key, so two notations of the same key compare equal. */
export function keyId({ key, control, alt, meta, shift }: KeyToken): string {
  const flags = [control && "C", alt && "A", meta && "D", shift && "S"].filter(Boolean);

  return [...flags, key].join("-");
}

export const isFunctionKey = (key: string): boolean => FUNCTION_KEY.test(key);

/** A modifier pressed on its own: on the way to a key, never a key itself. */
export const isModifierKey = (key: string): boolean => MODIFIER_KEYS.has(key);

export const isModified = (input: Modifiers): boolean => input.control || input.alt || input.meta;

/**
 * Ctrl, Alt and Meta match exactly. A plain letter is the character typed,
 * as vim reads it. A held letter falls back to its physical key under Alt
 * and on non-Latin layouts. A printable non-letter is its glyph; see below.
 */
export function matchesKey(bound: KeyToken, input: KeyInput): boolean {
  if (input.control !== bound.control || input.alt !== bound.alt || input.meta !== bound.meta) {
    return false;
  }

  if (isLetter(bound.key)) {
    if (!isModified(input))
      return input.key === (bound.shift ? bound.key.toUpperCase() : bound.key);

    if (input.shift !== bound.shift) return false;
    const physical = input.code === `Key${bound.key.toUpperCase()}`;

    if (input.alt) return physical;

    return input.key.toLowerCase() === bound.key || (isOtherScript(input.key) && physical);
  }

  // `Mod++` is the glyph, whichever key types it. Written Shift must be held,
  // and a digit then also matches its physical key, which Shift turns into a symbol.
  if (isSingle(bound.key)) {
    if (!bound.shift) return input.key === bound.key;

    return input.shift && (input.key === bound.key || input.code === `Digit${bound.key}`);
  }

  return input.shift === bound.shift && input.key === bound.key;
}
