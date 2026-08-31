import { type, type Type } from "arktype";
import type { Problem } from "../../shared/config";

/**
 * Runtime validation of typed boundaries. `parse()` adapts ArkType's
 * success/failure shape into `{ value, problem }`, where `problem` is a
 * single `Problem` (the existing config-layer reporter reads it directly).
 * `parseAll()` returns every failure for callers that can show more than
 * one message at a time.
 */
export type ParseResult<T> =
  | { value: T; problem: undefined }
  | { value: undefined; problem: Problem };

/** A non-empty string — empty is a config mistake, not a missing value. */
export const nonEmptyString = type("string > 0");

/** A URL string parseable by `new URL`. The shape, not the reachability. */
export const urlString = type("string.url");

/** Milliseconds since the Unix epoch. */
export const epochMillis = type("number.integer >= 0");

const ArkErrors = type.errors;

/**
 * Validates `value` against the ArkType. `field` is the dotted path of
 * the first failure (e.g. `"user.email"`) — same convention the config
 * parser uses, so `reportProblems` reads it from any boundary.
 *
 * The parameter is `unknown` on purpose: this *is* the boundary. The
 * lint override lives in `vite.config.ts`; the SAFETY comment below is
 * the per-call acknowledgement of the same fact.
 */
export function parse<T>(validator: Type<T>, value: unknown): ParseResult<T> {
  const result = validator(value);
  if (result instanceof ArkErrors) {
    const first = result[0];
    if (first === undefined) {
      // ArkType can in principle produce an empty errors array; the result
      // still failed, so fall back to a generic message rather than
      // treating that as success.
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
 * Like `parse`, but returns every failure instead of the first. The
 * `unknown` parameter and SAFETY cast follow the same boundary rationale.
 */
export function parseAll<T>(
  validator: Type<T>,
  value: unknown,
): { value: T; problems: Problem[] } | { problems: Problem[] } {
  const result = validator(value);
  if (result instanceof ArkErrors) {
    return { problems: result.map((p) => ({ field: fieldOf(p.path), reason: p.problem })) };
  }
  // SAFETY: same as `parse()`.
  return { value: result as T, problems: [] };
}

/**
 * A JSON path: dot-separated for objects, bracket indices for arrays.
 * Empty (top-level failure) becomes `"<root>"` so the `Problem` always
 * has a non-empty `field`.
 */
function fieldOf(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "<root>";
  return path
    .map((segment) => (Number.isInteger(segment) ? `[${String(segment)}]` : String(segment)))
    .join(".")
    .replace(/\.(\[)/g, "$1");
}
