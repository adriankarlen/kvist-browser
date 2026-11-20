import { Result, Schema, SchemaIssue } from "effect";
import type { Problem } from "../../shared/config";

/**
 * Schema failures in the config layer's `Problem` shape, so
 * `reportProblems` reads a failure from any boundary. `parseAll` keeps
 * every failure for callers that can show more than one.
 */
export type ParseResult<T> =
  | { value: T; problem: undefined }
  | { value: undefined; problem: Problem };

/** A non-empty string — empty is a config mistake, not a missing value. */
export const nonEmptyString = Schema.NonEmptyString;

function isUrl(value: string): boolean {
  return URL.canParse(value);
}

/** A URL string parseable by `new URL`. The shape, not the reachability. */
export const urlString = Schema.String.check(
  Schema.makeFilter((value: string) => isUrl(value) || "not a url"),
);

/** Milliseconds since the Unix epoch. */
export const epochMillis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const format = SchemaIssue.makeFormatterStandardSchemaV1();

type Decoder<T> = Schema.Codec<T, unknown>;

function problemsOf(issue: SchemaIssue.Issue): Problem[] {
  const problems = format(issue).issues.map((entry): Problem => ({
    field: fieldOf(entry.path ?? []),
    reason: entry.message,
  }));

  return problems.length > 0
    ? problems
    : [{ field: "<root>", reason: "did not match the expected shape" }];
}

/** Decodes `value`; `field` is the dotted path of the first failure. */
export function parse<T>(schema: Decoder<T>, value: unknown): ParseResult<T> {
  const result = Schema.decodeUnknownResult(schema)(value);

  if (Result.isSuccess(result)) return { value: result.success, problem: undefined };

  return { value: undefined, problem: problemsOf(result.failure.issue)[0]! };
}

/** Like `parse`, but returns every failure instead of the first. */
export function parseAll<T>(
  schema: Decoder<T>,
  value: unknown,
): { value: T; problems: Problem[] } | { problems: Problem[] } {
  const result = Schema.decodeUnknownResult(schema)(value, { errors: "all" });

  if (Result.isSuccess(result)) return { value: result.success, problems: [] };

  return { problems: problemsOf(result.failure.issue) };
}

type PathSegment = PropertyKey | { readonly key: PropertyKey };

function isKeyed(segment: PathSegment): segment is { readonly key: PropertyKey } {
  return typeof segment === "object";
}

/**
 * A JSON path: dot-separated for objects, bracket indices for arrays. A
 * top-level failure is `"<root>"`, so a `Problem` always names a field.
 */
function fieldOf(path: ReadonlyArray<PathSegment>): string {
  if (path.length === 0) return "<root>";

  return path
    .map((segment) => {
      const key = isKeyed(segment) ? segment.key : segment;

      return Number.isInteger(key) ? `[${String(key)}]` : String(key);
    })
    .join(".")
    .replace(/\.(\[)/g, "$1");
}
