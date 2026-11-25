import { Result, Schema } from "effect";
import type { Problem } from "../shared/config";

export type Table = Readonly<Record<string, unknown>>;

/** Anything claiming to be a TOML table: a plain, non-list object. */
export function isTable(value: unknown): value is Table {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One field, decoded on its own so a bad value costs only itself. An absent
 * value is the default, not a problem: only something the user wrote and we
 * could not use is worth telling them about.
 */
export function read<A, F>(
  value: unknown,
  field: string,
  schema: Schema.Codec<A, unknown>,
  reason: string,
  fallback: F,
  problems: Problem[],
): A | F {
  if (value === undefined) return fallback;
  const decoded = Schema.decodeUnknownResult(schema)(value);

  if (Result.isSuccess(decoded)) return decoded.success;
  problems.push({ field, reason });

  return fallback;
}

/**
 * A `[section]` of the file. Written as anything but a table it has no fields
 * to read, so it is reported once rather than as every child of it quietly
 * defaulting.
 */
export function section(value: unknown, field: string, problems: Problem[]): Table {
  if (value === undefined) return {};

  if (isTable(value)) return value;
  problems.push({ field, reason: "not a table" });

  return {};
}

export const quoted = (names: ReadonlyArray<string>): string =>
  names.map((n) => `"${n}"`).join(", ");

export function reportUnknownKeys(
  table: Table,
  field: string,
  known: ReadonlyArray<string>,
  problems: Problem[],
): void {
  for (const key of Object.keys(table)) {
    if (!known.includes(key)) {
      problems.push({
        field: `${field}.${key}`,
        reason: `unknown key; expected ${quoted(known)}`,
      });
    }
  }
}
