import { Result, Schema } from "effect";
import type { Problem } from "../../../shared/config";
import type { InputMode } from "../../../shared/schema/config";
import {
  type Binding,
  type KeyTable,
  type KeyToken,
  MODAL_TABLES,
} from "../../../shared/schema/keymap";
import { bindableCommand, defaultKeys } from "../../commands";
import { reportUnknownKeys, section, type Table } from "../../toml-fields";
import { isFunctionKey, isModified, keyId, parseChord, parseKeys } from "./keybinds";

/** One `[keys]` table, from config.toml or a preset file. */
export interface KeyLayer {
  /** The `[keys]` value as TOML read it. */
  readonly keys: unknown;
  /** Where it came from, for problems. Absent for config.toml. */
  readonly file?: string;
}

export interface BuiltKeymap {
  readonly bindings: ReadonlyArray<Binding>;
  readonly problems: ReadonlyArray<Problem>;
}

const TABLES: ReadonlyArray<KeyTable> = [...MODAL_TABLES, "chords"];

interface Entry {
  readonly binding: Binding;
  /** Which layer wrote it; undefined for a registry default, which never warns about itself. */
  readonly layer: { readonly file: string | undefined } | undefined;
}

const sequenceId = (keys: ReadonlyArray<KeyToken>): string => keys.map(keyId).join(" ");

function parseNotation(
  table: KeyTable,
  notation: string,
  platform: NodeJS.Platform,
): ReadonlyArray<KeyToken> | undefined {
  if (table !== "chords") return parseKeys(notation);
  const chord = parseChord(notation, platform);

  return chord === undefined ? undefined : [chord];
}

const field = (table: KeyTable, notation: string): string =>
  `keys.${table}.${JSON.stringify(notation)}`;

/** A binding for `line`, or why there cannot be one. */
function bind(
  table: KeyTable,
  keys: ReadonlyArray<KeyToken>,
  notation: string,
  line: string,
): Result.Result<Binding, string> {
  const [name = "", ...rest] = line.trim().split(/\s+/);
  const found = bindableCommand(name);

  if (found === undefined) return Result.fail(`no command "${name}"`);

  if (found === "unbindable") return Result.fail(`"${name}" cannot be bound to a key`);
  const arg = rest.join(" ");
  let binding: Binding = { table, keys, notation, command: found.name };

  if (arg !== "") binding = { ...binding, arg };

  if (found.enter !== undefined) binding = { ...binding, enter: found.enter };

  return Result.succeed(binding);
}

const isCommandLine = Schema.is(Schema.String);

/** Each table's bindings by key, so a later layer replaces a key however it is spelled. */
type Tables = Map<KeyTable, Map<string, Entry>>;

function applyLayer(
  tables: Tables,
  { keys, file }: KeyLayer,
  platform: NodeJS.Platform,
  problems: Problem[],
): void {
  const found: Problem[] = [];
  const root = section(keys, "keys", found);

  reportUnknownKeys(root, "keys", TABLES, found);

  for (const table of TABLES) {
    const raw: Table = section(root[table], `keys.${table}`, found);
    const entries = tables.get(table) ?? new Map<string, Entry>();
    const seen = new Map<string, string>();

    tables.set(table, entries);

    for (const [notation, value] of Object.entries(raw)) {
      const at = field(table, notation);
      const parsed = parseNotation(table, notation, platform);

      if (parsed === undefined) {
        found.push({ field: at, reason: "not a key" });
        continue;
      }

      const [first] = parsed;

      if (table === "chords" && first && !isModified(first) && !isFunctionKey(first.key)) {
        found.push({
          field: at,
          reason: "needs Ctrl, Alt or Meta, or it would take the key from every text field",
        });
        continue;
      }

      const id = sequenceId(parsed);
      const earlier = seen.get(id);

      if (earlier !== undefined) {
        found.push({ field: at, reason: `same key as ${JSON.stringify(earlier)}; this one wins` });
      }

      seen.set(id, notation);

      if (!isCommandLine(value)) {
        found.push({ field: at, reason: "not a command line" });
        continue;
      }

      if (value.trim() === "") {
        entries.delete(id);
        continue;
      }

      const bound = bind(table, parsed, notation, value);

      if (Result.isFailure(bound)) {
        found.push({ field: at, reason: bound.failure });
        continue;
      }

      // Deleted first, so the key moves to the end, where a later layer's keys belong.
      entries.delete(id);
      entries.set(id, { binding: bound.success, layer: { file } });
    }
  }

  problems.push(...found.map((problem) => (file === undefined ? problem : { ...problem, file })));
}

const startsWith = (long: ReadonlyArray<KeyToken>, short: ReadonlyArray<KeyToken>): boolean =>
  long.length > short.length && short.every((key, i) => keyId(key) === keyId(long[i] ?? key));

const named = ({ notation, command }: Binding): string =>
  `${JSON.stringify(notation)} (${command})`;

function problemAt(entry: Entry, reason: string): Problem {
  const at = field(entry.binding.table, entry.binding.notation);
  const file = entry.layer?.file;

  return file === undefined ? { field: at, reason } : { field: at, reason, file };
}

/** A key that is a prefix of a longer one fires first, so the longer one can never be typed. */
function reportShadowed(entries: ReadonlyArray<Entry>, problems: Problem[]): void {
  for (const short of entries) {
    const hidden = entries.filter((long) => startsWith(long.binding.keys, short.binding.keys));

    if (short.layer !== undefined && hidden.length > 0) {
      problems.push(
        problemAt(short, `hides ${hidden.map(({ binding }) => named(binding)).join(", ")}`),
      );
      continue;
    }

    for (const long of hidden) {
      if (long.layer !== undefined) {
        problems.push(problemAt(long, `hidden by ${named(short.binding)}`));
      }
    }
  }
}

/** Chords are matched before any mode's keys, so a modal key sharing one never fires. */
function reportChordClashes(
  modal: ReadonlyArray<Entry>,
  chords: ReadonlyArray<Entry>,
  problems: Problem[],
): void {
  for (const chord of chords) {
    const [held] = chord.binding.keys;

    if (held === undefined) continue;

    for (const entry of modal) {
      const clashes = entry.binding.keys.some((key) => keyId(key) === keyId(held));

      if (!clashes || (entry.layer === undefined && chord.layer === undefined)) continue;

      problems.push(
        entry.layer === undefined
          ? problemAt(chord, `hides ${named(entry.binding)} in ${entry.binding.table} mode`)
          : problemAt(entry, `hidden by chord ${JSON.stringify(chord.binding.notation)}`),
      );
    }
  }
}

/**
 * The bindings a preset ends up with: the registry's defaults for its engine,
 * then each layer in turn. An empty command line unbinds a key. A standard
 * preset reads chords only, so its modal tables are checked but unused.
 */
export function buildKeymap(
  engine: InputMode,
  layers: ReadonlyArray<KeyLayer>,
  platform: NodeJS.Platform = process.platform,
): BuiltKeymap {
  const tables: Tables = new Map(TABLES.map((table) => [table, new Map<string, Entry>()]));
  const problems: Problem[] = [];

  for (const { table, notation, command, arg } of defaultKeys(engine, platform)) {
    const keys = parseNotation(table, notation, platform);
    const line = arg === undefined ? command : `${command} ${arg}`;
    const bound = keys === undefined ? undefined : bind(table, keys, notation, line);

    if (keys !== undefined && bound !== undefined && Result.isSuccess(bound)) {
      tables.get(table)?.set(sequenceId(keys), { binding: bound.success, layer: undefined });
    }
  }

  for (const layer of layers) applyLayer(tables, layer, platform, problems);

  const used: ReadonlyArray<KeyTable> = engine === "vim" ? TABLES : ["chords"];
  const entriesOf = (table: KeyTable): Entry[] => [...(tables.get(table)?.values() ?? [])];
  const chords = entriesOf("chords");

  if (engine === "vim") {
    for (const table of MODAL_TABLES) reportShadowed(entriesOf(table), problems);
    reportChordClashes(MODAL_TABLES.flatMap(entriesOf), chords, problems);
  }

  return {
    bindings: used.flatMap((table) => entriesOf(table).map(({ binding }) => binding)),
    problems,
  };
}
