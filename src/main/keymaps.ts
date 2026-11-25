import { Result, Schema } from "effect";
import { Toml } from "effect/encoding";
import type { Problem } from "../shared/config";
import { InputMode, RecipeName } from "../shared/schema/config";
import type { Keymap } from "../shared/schema/keymap";
import { buildKeymap, type KeyLayer } from "./features/vim/keymap";
import { quoted, read } from "./toml-fields";

/** A preset `[input] mode` can name: the engine it runs on and the keys it adds. */
export interface KeymapPreset {
  readonly name: string;
  readonly engine: InputMode;
  /** The preset file's `[keys]`. A built-in preset has none: its keys are the registry's. */
  readonly layers: ReadonlyArray<KeyLayer>;
  readonly meta: { readonly name?: string; readonly description?: string };
  /** What is wrong with the file, reported only while the preset is in use. */
  readonly problems: ReadonlyArray<Problem>;
}

const ENGINES: ReadonlyArray<InputMode> = InputMode.literals;

/** The engine a built-in preset is named after, or undefined for any other name. */
export const builtInEngine = (name: string): InputMode | undefined =>
  ENGINES.find((engine) => engine === name);

const presetOf = (engine: InputMode): KeymapPreset => ({
  name: engine,
  engine,
  layers: [],
  meta: {},
  problems: [],
});

const builtInPreset = (name: string): KeymapPreset | undefined => {
  const engine = builtInEngine(name);

  return engine === undefined ? undefined : presetOf(engine);
};

/** A built-in preset's keys, from the registry alone. */
export function builtInKeymap(engine: InputMode, platform = process.platform): Keymap {
  return { name: engine, bindings: buildKeymap(engine, [], platform).bindings };
}

/** Where a user preset lives, relative to the config directory. Problems name it. */
export const keymapFile = (name: string): string => `keymaps/${name}.toml`;

export const isKeymapName = Schema.is(RecipeName);

export interface UserKeymaps {
  readonly names: ReadonlyArray<string>;
  readonly problems: ReadonlyArray<Problem>;
}

/** Which user presets a directory listing holds: each `.toml` with a usable name. */
export function listUserKeymaps(entries: ReadonlyArray<string>): UserKeymaps {
  const names: string[] = [];
  const problems: Problem[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".toml") || entry.startsWith(".")) continue;
    const stem = entry.slice(0, -".toml".length);

    if (isKeymapName(stem)) names.push(stem);
    else {
      const file = keymapFile(stem);

      problems.push({
        file,
        field: file,
        reason: 'not a keymap name: lowercase letters, digits and "-"',
      });
    }
  }

  return { names: names.sort(), problems };
}

/** Every preset that can be named: the user's and the built-in ones, once each. */
export const keymapCatalog = (user: Iterable<string>): ReadonlyArray<string> =>
  [...new Set([...user, ...ENGINES])].sort();

/** The keymap format this Kvist reads. Bump it only for a change an older Kvist would misread. */
const FORMAT = 1;

const FILE_KEYS: ReadonlyArray<string> = ["format", "name", "description", "base", "keys"];

/**
 * Reads a user preset. `base` picks the engine and its default keys; `[keys]`
 * goes over them. A format this Kvist does not know leaves the base keys alone.
 */
export function parseKeymapFile(name: string, toml: string): KeymapPreset {
  const file = keymapFile(name);
  const problems: Problem[] = [];

  const result = (
    engine: InputMode = "vim",
    layers: ReadonlyArray<KeyLayer> = [],
    meta: KeymapPreset["meta"] = {},
  ): KeymapPreset => ({
    name,
    engine,
    layers,
    meta,
    problems: problems.map((problem) => ({ ...problem, file })),
  });

  const parsed = Toml.parse(toml);

  if (Result.isFailure(parsed)) {
    problems.push({ field: file, reason: parsed.failure.message });

    return result();
  }

  const root = parsed.success;
  const base = read(root.base, "base", InputMode, `not one of ${quoted(ENGINES)}`, "vim", problems);

  if (root.format === undefined) {
    problems.push({ field: file, reason: `no format; add format = ${FORMAT}` });

    return result(base);
  }

  if (root.format !== FORMAT) {
    problems.push({ field: "format", reason: `only format ${FORMAT} is supported; keys skipped` });

    return result(base);
  }

  for (const key of Object.keys(root)) {
    if (!FILE_KEYS.includes(key)) {
      problems.push({ field: key, reason: `unknown key; expected ${quoted(FILE_KEYS)}` });
    }
  }

  const text = (key: "name" | "description"): KeymapPreset["meta"] => {
    const value = read(root[key], key, Schema.String, "not a string", undefined, problems);

    return value === undefined ? {} : { [key]: value };
  };

  return result(base, [{ keys: root.keys, file }], { ...text("name"), ...text("description") });
}

export interface ResolvedKeymap {
  readonly preset: KeymapPreset;
  readonly problems: ReadonlyArray<Problem>;
}

/**
 * The preset a name means. A user preset shadows a built-in one. An unknown
 * name falls back to `fallback`, the recipe's preset, and then to vim.
 */
export function resolveKeymap(
  name: string,
  fallback: string,
  user: ReadonlyMap<string, KeymapPreset>,
): ResolvedKeymap {
  const find = (candidate: string): KeymapPreset | undefined =>
    user.get(candidate) ?? builtInPreset(candidate);

  const found = find(name);

  if (found !== undefined) return { preset: found, problems: found.problems };
  const preset = find(fallback) ?? presetOf("vim");

  return {
    preset,
    problems: [
      {
        field: "input.mode",
        reason: `no keymap named "${name}"; available: ${quoted(keymapCatalog(user.keys()))}`,
      },
      ...preset.problems,
    ],
  };
}
