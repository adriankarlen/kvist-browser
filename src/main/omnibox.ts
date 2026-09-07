import type { OmniboxSuggestion } from "../shared/ipc";
import type { Bookmarks } from "./bookmarks";
import type { History } from "./history";

/** Rows asked of each source; the omnibox shows only a handful, so a deep search would be wasted work. */
const SOURCE_LIMIT = 8;

/**
 * Candidates for the omnibox's dropdown, merged from `Bookmarks.search` and
 * `History.search`. A bookmark is the more deliberate signal — the user
 * chose to keep the page, not just visited it — so a URL bookmarked *and*
 * visited shows once, as a bookmark, and bookmarks are listed first.
 */
export function omniboxSuggestions(
  history: History,
  bookmarks: Bookmarks,
  query: string,
): OmniboxSuggestion[] {
  if (query.trim() === "") return [];

  const bookmarkRows = bookmarks.search(query, { limit: SOURCE_LIMIT });
  const bookmarked = new Set(bookmarkRows.map((row) => row.url));
  const historyRows = history
    .search(query, { limit: SOURCE_LIMIT })
    .filter((row) => !bookmarked.has(row.url));

  return [
    ...bookmarkRows.map(
      (row): OmniboxSuggestion => ({ label: row.title, value: row.url, kind: "bookmark" }),
    ),
    ...historyRows.map(
      (row): OmniboxSuggestion => ({ label: row.title, value: row.url, kind: "history" }),
    ),
  ];
}
