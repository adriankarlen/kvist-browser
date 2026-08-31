import { type, type Type } from "arktype";
import type { Problem } from "../../shared/config";

/**
 * The runtime validation seam. The project validates typed boundaries with
 * ArkType: DB rows on read, IPC payloads at the transport, config values on
 * load. All of those call sites want a single shape back — either the typed
 * value or a `Problem` that fits the existing config-layer reporter — so
 * they reach for `parse()` rather than hand-rolling type guards.
 *
 * ArkType returns the value on success and an `ArkErrors` (an `Array` of
 * `ArkError`) on failure. `parse()` adapts that into the project's
 * `{ value, problem }` shape, where `problem` is a single `Problem`
 * describing the first failure (or `undefined` on success). Multi-error
 * cases collapse to the first so a caller that can only show one message at
 * a time has something to show; a caller that wants them all can call
 * `parseAll()`.
 */
export type ParseResult<T> =
  | { value: T; problem: undefined }
  | { value: undefined; problem: Problem };

/** A non-empty string. Empty is a config mistake, not a missing value. */
export const nonEmptyString = type("string > 0");

/** A URL string parseable by `new URL`. The shape, not the reachability. */
export const urlString = type("string.url");

/** Milliseconds since the Unix epoch. */
export const epochMillis = type("number.integer >= 0");

const ArkErrors = type.errors;

/**
 * Validates `value` against the ArkType `T`. On success returns the typed
 * value; on failure returns a single `Problem` whose `field` is the dotted
 * path of the first failure and `reason` is ArkType's human description.
 *
 * `field` is the path inside the value, e.g. `"url"` for a top-level
 * string, or `"user.email"` for a nested object — same convention the config
 * parser uses, so the existing `reportProblems` flow reads it correctly.
 *
 * The parameter is `unknown` on purpose: this *is* the boundary. The
 * corresponding lint override lives in `vite.config.ts` and the SAFETY
 * comment below is the per-call acknowledgement of the same fact.
 */
export function parse<T>(validator: Type<T>, value: unknown): ParseResult<T> {
  const result = validator(value);
  if (result instanceof ArkErrors) {
    const first = result[0];
    if (first === undefined) {
      // ArkType can in principle produce an empty errors array; the result
      // still failed validation, so fall back to a generic message rather than
      // silently treating that as success.
      return {
        value: undefined,
        problem: { field: "<root>", reason: "did not match the expected shape" },
      };
    }
    return {
      value: undefined,
      problem: { field: fieldOf(first.path), reason: first.problem },
    };
  }
  // SAFETY: the success branch of a Type<T> is the value parsed to T; the
  // `finalizeDistillation` wrapper is an internal ArkType detail, not a
  // representation choice the caller can opt out of.
  return { value: result as T, problem: undefined };
}

/**
 * Like `parse`, but returns every `Problem` ArkType produced instead of just
 * the first. Use this when a caller can show all of them at once — the
 * config parser already does, via `loadConfig` -> `reportProblems`.
 *
 * The SAFETY comment on `parse()` applies here too: the parameter is
 * `unknown` because this is the boundary.
 */
export function parseAll<T>(
  validator: Type<T>,
  value: unknown,
): { value: T; problems: Problem[] } | { problems: Problem[] } {
  const result = validator(value);
  if (result instanceof ArkErrors) {
    return { problems: result.map((p) => ({ field: fieldOf(p.path), reason: p.problem })) };
  }
  // SAFETY: same as `parse()` — the success branch is the value, parsed to
  // T; the wrapper type is an internal ArkType detail.
  return { value: result as T, problems: [] };
}

/**
 * A JSON path as the file spells it: dot-separated for objects, bracket
 * indices for arrays. Empty (top-level failure) becomes `"<root>"` so the
 * `Problem` always has a non-empty `field`.
 *
 * The segments are `PropertyKey` (`string | number | symbol`); a numeric
 * segment is treated as an array index. Symbols are coerced via `String()`,
 * which is what the JSON path standard does for unusual key types.
 */
function fieldOf(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "<root>";
  return path
    .map((segment) => (Number.isInteger(segment) ? `[${String(segment)}]` : String(segment)))
    .join(".")
    .replace(/\.(\[)/g, "$1");
}
