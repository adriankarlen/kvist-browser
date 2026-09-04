/**
 * Helpers shared by every SQLite-backed store. `clampLimit` and `escapeLike`
 * are not store-specific: they are about turning caller input into safe SQL
 * fragments, and a copy per store is how one gets the escape order right
 * here and wrong there.
 */

/** Default cap on a single search/list call — enough for a panel, small enough to scan. */
export const DEFAULT_LIMIT = 50;
/** The hard ceiling — a runaway limit would scan the whole table. */
export const MAX_LIMIT = 500;

/**
 * Clamps the limit to a sane range. A negative or zero limit means "no
 * rows", which is rarely what the caller wanted, so the default takes its
 * place.
 */
export function clampLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

/**
 * Escapes the three LIKE metacharacters: the escape char itself, then `%`
 * and `_`. Order matters — backslash first, otherwise the escapes added
 * for `%` and `_` would themselves be re-escaped on a second pass.
 */
export function escapeLike(pattern: string): string {
  return pattern.replace(/[\\%_]/g, "\\$&");
}
