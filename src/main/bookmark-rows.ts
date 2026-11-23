import { Effect } from "effect";
import type { Bookmark } from "../shared/schema/bookmarks";
import { MAX_LIMIT } from "./db/query";
import { BookmarksRepo } from "./services/bookmarks-repo";

/**
 * The rows the bookmarks panel shows for a filter, newest first. A blank
 * filter lists everything; the panel is where every bookmark is reachable,
 * so it asks for as many rows as a query may return.
 */
export const bookmarkRows = (
  query: string,
): Effect.Effect<ReadonlyArray<Bookmark>, never, BookmarksRepo> =>
  Effect.gen(function* () {
    const repo = yield* BookmarksRepo;
    const trimmed = query.trim();

    return trimmed === "" ? yield* repo.list(MAX_LIMIT) : yield* repo.search(trimmed, MAX_LIMIT);
  });
