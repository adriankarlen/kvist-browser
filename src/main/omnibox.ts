import { Effect, Schema } from "effect";
import type { OmniboxSuggestion } from "../shared/ipc";
import { parse } from "./db/validation";
import { BookmarksRepo } from "./services/bookmarks-repo";
import { HistoryRepo } from "./services/history-repo";

/** Rows asked of each source; the omnibox shows only a handful, so a deep search would be wasted work. */
const SOURCE_LIMIT = 8;

/** A query string, as it should arrive from the wire — validated here rather than trusted from it. */
const queryValidator = Schema.String;

/**
 * Keeps the first row per URL. Both `History` (a reload is its own row)
 * and `Bookmarks` (two rows per URL is intentional, see `db/schema/
 * bookmarks.ts`) can return duplicates; both return newest first, so the
 * first occurrence is the newest.
 */
function dedupeByUrl<T extends { url: string }>(rows: ReadonlyArray<T>): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const row of rows) {
    if (seen.has(row.url)) continue;
    seen.add(row.url);
    deduped.push(row);
  }

  return deduped;
}

/**
 * Candidates for the omnibox dropdown, merged from `Bookmarks.search` and
 * `History.search`. A bookmark is the deliberate signal — chosen, not
 * visited — so a double-hit URL shows once, as a bookmark, first.
 *
 * `query` is validated, not trusted: it crosses IPC as `unknown`.
 */
export const omniboxSuggestions = (
  query: unknown,
): Effect.Effect<OmniboxSuggestion[], never, HistoryRepo | BookmarksRepo> =>
  Effect.gen(function* () {
    const validated = parse(queryValidator, query);
    // One trim up front: an empty query (invalid payload or whitespace) answers
    // nothing, and neither source search should see padded input.
    const trimmed = validated.problem === undefined ? validated.value.trim() : "";

    if (trimmed === "") return [];

    const history = yield* HistoryRepo;
    const bookmarks = yield* BookmarksRepo;
    const bookmarkRows = dedupeByUrl(yield* bookmarks.search(trimmed, SOURCE_LIMIT));
    const bookmarked = new Set(bookmarkRows.map((row) => row.url));

    const historyRows = dedupeByUrl(yield* history.search(trimmed, SOURCE_LIMIT)).filter(
      (row) => !bookmarked.has(row.url),
    );

    return [
      ...bookmarkRows.map((row): OmniboxSuggestion => ({
        label: row.title,
        value: row.url,
        kind: "bookmark",
      })),
      ...historyRows.map((row): OmniboxSuggestion => ({
        label: row.title,
        value: row.url,
        kind: "history",
      })),
    ];
  });
