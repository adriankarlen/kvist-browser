import { desc, sql } from "drizzle-orm";
import { type } from "arktype";
import { originOf } from "../shared/url";
import type { Database } from "./db/database";
import { history } from "./db/schema";
import { epochMillis, nonEmptyString, parse, urlString } from "./db/validation";
import { errorPageTarget } from "./error-page";

/**
 * A row of the history table, as it comes back from a query. The shape is
 * what `drizzle-arktype` derives from the table; `History` returns these
 * directly so callers do not have to remember which keys are camelCase.
 */
export interface HistoryRow {
  id: number;
  url: string;
  title: string;
  origin: string | null;
  visitedAt: number;
}

const DEFAULT_LIMIT = 50;
/** The hard ceiling on a single search/recent call — a runaway limit would scan the whole table. */
const MAX_LIMIT = 500;

/**
 * Shape of `record`'s argument. Composed from the per-field validators so a
 * single `parse()` call produces one failure report and the validated value
 * feeds straight into the insert.
 */
const recordValidator = type({
  url: urlString,
  title: nonEmptyString,
  visitedAt: epochMillis,
});

/**
 * What `record` takes. The URL's title is whatever the tab has at the moment
 * of commit, which is usually the URL itself until `page-title-updated`
 * fires; updating the row when that arrives is out of scope for the store.
 */
export interface RecordInput {
  url: string;
  title: string;
  visitedAt: number;
}

export interface SearchOptions {
  /** Cap on returned rows; clamped to `[1, MAX_LIMIT]`. */
  limit?: number;
}

/**
 * App-scoped, like `Downloads`, `Permissions`, `ZoomStore`: a navigation is
 * a fact about the session, not about any one window, so the store lives at
 * the top of `index.ts` and every `TabManager` writes through the same one.
 *
 * Writes are filtered at this seam so a malformed call cannot pollute the
 * table from any layer above. Error-page wrappers are dropped (they are
 * Chromium's bookkeeping, not a page the user visited), and origins we
 * would not want to remember — `data:`, `blob:` — are dropped because they
 * have no place in a URL search.
 */
export class History {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Appends one row. Skips silently and returns `false` when the row would
   * be a wrapper or an opaque origin, or when the input fails the schema
   * validation — callers are all in main and the rejection is intentional,
   * so the noise of a log line on every filtered navigation would not pay
   * for itself.
   */
  record(input: RecordInput): boolean {
    const validated = parse(recordValidator, input);
    if (validated.problem !== undefined) return false;
    if (originOf(validated.value.url) === null) return false;
    if (errorPageTarget(validated.value.url) !== null) return false;

    this.#db.drizzle
      .insert(history)
      .values({
        url: validated.value.url,
        title: validated.value.title,
        origin: originOf(validated.value.url),
        visitedAt: validated.value.visitedAt,
      })
      .run();
    return true;
  }

  /**
   * LIKE-pattern match against URL and title. Returns the newest rows
   * first, capped by `options.limit` (default 50, max 500). The pattern is
   * wrapped with `%`s so callers pass the thing they are searching for,
   * not a complete LIKE expression; `%`, `_` and `\` in the input are
   * escaped so a query like `%` is a search for the literal `%`, not "any
   * string".
   */
  search(pattern: string, options: SearchOptions = {}): HistoryRow[] {
    const validation = parse(nonEmptyString, pattern);
    if (validation.problem !== undefined) return [];
    const limit = clampLimit(options.limit ?? DEFAULT_LIMIT);
    const like_ = `%${escapeLike(validation.value)}%`;

    return this.#db.drizzle
      .select({
        id: history.id,
        url: history.url,
        title: history.title,
        origin: history.origin,
        visitedAt: history.visitedAt,
      })
      .from(history)
      .where(
        sql`(${history.url} LIKE ${like_} ESCAPE '\\' OR ${history.title} LIKE ${like_} ESCAPE '\\')`,
      )
      .orderBy(desc(history.visitedAt), desc(history.id))
      .limit(limit)
      .all();
  }

  /** Newest rows, no query. The shape omnibox suggestions will likely want. */
  recent(limit: number = DEFAULT_LIMIT): HistoryRow[] {
    const capped = clampLimit(limit);
    return this.#db.drizzle
      .select({
        id: history.id,
        url: history.url,
        title: history.title,
        origin: history.origin,
        visitedAt: history.visitedAt,
      })
      .from(history)
      .orderBy(desc(history.visitedAt), desc(history.id))
      .limit(capped)
      .all();
  }
}

/** Clamps the limit to a sane range. A negative or zero limit means "no rows", which is rarely what the caller wanted. */
function clampLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

/**
 * Escapes the three LIKE metacharacters: the escape char itself, then `%`
 * and `_`. Order matters — backslash first, otherwise the escapes added
 * for `%` and `_` would themselves be re-escaped on a second pass.
 */
function escapeLike(pattern: string): string {
  return pattern.replace(/[\\%_]/g, "\\$&");
}
