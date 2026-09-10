import { desc, eq, sql } from "drizzle-orm";
import { type } from "arktype";
import type { Database } from "./db/database";
import { bookmarks } from "./db/schema";
import { clampLimit, DEFAULT_LIMIT, escapeLike } from "./db/query";
import { epochMillis, nonEmptyString, parse, urlString } from "./db/validation";

/**
 * A row of the bookmarks table, as it comes back from a query. The shape is
 * what `drizzle-arktype` derives from the table; `Bookmarks` returns these
 * directly so callers do not have to remember which keys are camelCase.
 */
export interface BookmarkRow {
  id: number;
  url: string;
  title: string;
  createdAt: number;
}

/**
 * Shape of `add`'s argument. Composed from the per-field validators so a
 * single `parse()` call produces one failure report and the validated value
 * feeds straight into the insert.
 */
const addValidator = type({
  url: urlString,
  title: nonEmptyString,
  createdAt: epochMillis,
});

/**
 * What `add` takes. `createdAt` defaults to `Date.now()` inside `add` — the
 * rationale lives on the schema, where the "two rows per URL are intentional"
 * rule is also kept.
 */
export interface AddInput {
  url: string;
  title: string;
  createdAt?: number;
}

export interface ListOptions {
  /** Cap on returned rows; clamped to `[1, MAX_LIMIT]`. */
  limit?: number;
}

export interface SearchOptions {
  /** Cap on returned rows; clamped to `[1, MAX_LIMIT]`. */
  limit?: number;
}

/**
 * App-scoped like `History`: a bookmark outlives its window, so one store
 * serves every caller. Writes are filtered here so a malformed call cannot
 * pollute the table — same silent-false vocabulary as `History`.
 */
export class Bookmarks {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Appends one row, false on schema-invalid input, silently, like
   * `History.record` — a malformed call is a programming mistake.
   * `createdAt` defaults to now because it dates the call, not an upstream
   * event, so callers need not pass it.
   */
  add(input: AddInput): boolean {
    const createdAt = input.createdAt === undefined ? Date.now() : input.createdAt;
    const validated = parse(addValidator, { ...input, createdAt });
    if (validated.problem !== undefined) return false;

    this.#db.drizzle
      .insert(bookmarks)
      .values({
        url: validated.value.url,
        title: validated.value.title,
        createdAt: validated.value.createdAt,
      })
      .run();
    return true;
  }

  /**
   * Drops the row by id. Returns `true` when a row was deleted, `false`
   * when no such row existed — a delete that did not find its target is not
   * an error, just a no-op the caller can observe.
   */
  remove(id: number): boolean {
    if (!Number.isInteger(id) || id < 1) return false;
    const result = this.#db.drizzle.delete(bookmarks).where(eq(bookmarks.id, id)).run();
    return result.changes > 0;
  }

  /**
   * Fetches one row by id, or null. Bad input reads as "no such row": the
   * only wrong id is a stale UI snapshot, and an error there would break
   * the chrome over a row that vanished.
   */
  get(id: number): BookmarkRow | null {
    if (!Number.isInteger(id) || id < 1) return null;
    const rows = this.#db.drizzle
      .select({
        id: bookmarks.id,
        url: bookmarks.url,
        title: bookmarks.title,
        createdAt: bookmarks.createdAt,
      })
      .from(bookmarks)
      .where(eq(bookmarks.id, id))
      .all();
    return rows[0] ?? null;
  }

  /**
   * Whether a row exists for this URL. The UI uses this to decide whether
   * "Bookmark this page" should add or remove; the store itself never has
   * to know, and `add` keeps writing whatever it is handed.
   */
  has(url: string): boolean {
    const validation = parse(urlString, url);
    if (validation.problem !== undefined) return false;
    const rows = this.#db.drizzle
      .select({ id: bookmarks.id })
      .from(bookmarks)
      .where(eq(bookmarks.url, validation.value))
      .all();
    return rows.length > 0;
  }

  /**
   * LIKE-pattern match against URL and title, newest first, capped by
   * `options.limit` (default 50, max 500). The pattern is wrapped with
   * `%`s so callers pass what they search for; `%`, `_` and `\` are
   * escaped so a query like `%` means the literal `%`.
   */
  search(pattern: string, options: SearchOptions = {}): BookmarkRow[] {
    const validation = parse(nonEmptyString, pattern);
    if (validation.problem !== undefined) return [];
    const limit = clampLimit(options.limit ?? DEFAULT_LIMIT);
    const like_ = `%${escapeLike(validation.value)}%`;

    return this.#db.drizzle
      .select({
        id: bookmarks.id,
        url: bookmarks.url,
        title: bookmarks.title,
        createdAt: bookmarks.createdAt,
      })
      .from(bookmarks)
      .where(
        sql`(${bookmarks.url} LIKE ${like_} ESCAPE '\\' OR ${bookmarks.title} LIKE ${like_} ESCAPE '\\')`,
      )
      .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
      .limit(limit)
      .all();
  }

  /** Newest rows, no query. The shape a panel will likely want. */
  list(options: ListOptions = {}): BookmarkRow[] {
    const capped = clampLimit(options.limit ?? DEFAULT_LIMIT);
    return this.#db.drizzle
      .select({
        id: bookmarks.id,
        url: bookmarks.url,
        title: bookmarks.title,
        createdAt: bookmarks.createdAt,
      })
      .from(bookmarks)
      .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
      .limit(capped)
      .all();
  }
}
