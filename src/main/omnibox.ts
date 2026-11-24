import { Effect } from "effect";
import type { BrowserState } from "../shared/schema/browser";
import type { OmniboxSuggestion } from "../shared/schema/completion";
import { BookmarksRepo } from "./services/bookmarks-repo";
import { HistoryRepo } from "./services/history-repo";

/** Rows asked of each source; the omnibox shows only a handful, so a deep search would be wasted work. */
const SOURCE_LIMIT = 8;

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

/** Open tabs whose title or URL contains the query. The active tab is left out: switching to it does nothing. */
export function tabSuggestions(browser: BrowserState, query: string): OmniboxSuggestion[] {
  const needle = query.trim().toLowerCase();

  if (needle === "") return [];

  const matches = (text: string): boolean => text.toLowerCase().includes(needle);

  return browser.tabs
    .filter((tab) => tab.id !== browser.activeId && (matches(tab.title) || matches(tab.url)))
    .slice(0, SOURCE_LIMIT)
    .map((tab) => ({
      label: tab.title === "" ? tab.url : tab.title,
      value: tab.url,
      kind: "tab",
      tabId: tab.id,
    }));
}

/**
 * Candidates for the omnibox dropdown: open tabs, then bookmarks, then
 * history. Each URL shows once, as the first of those it is. An open tab
 * wins because switching beats loading the page twice.
 */
export const omniboxSuggestions = (
  query: string,
  browser: BrowserState,
): Effect.Effect<OmniboxSuggestion[], never, HistoryRepo | BookmarksRepo> =>
  Effect.gen(function* () {
    // One trim up front: a blank query answers nothing, and neither source
    // search should see padded input.
    const trimmed = query.trim();

    if (trimmed === "") return [];

    const history = yield* HistoryRepo;
    const bookmarks = yield* BookmarksRepo;
    const tabRows = tabSuggestions(browser, trimmed);
    const open = new Set(tabRows.map((row) => row.value));

    const bookmarkRows = dedupeByUrl(yield* bookmarks.search(trimmed, SOURCE_LIMIT)).filter(
      (row) => !open.has(row.url),
    );

    const shown = new Set([...open, ...bookmarkRows.map((row) => row.url)]);

    const historyRows = dedupeByUrl(yield* history.search(trimmed, SOURCE_LIMIT)).filter(
      (row) => !shown.has(row.url),
    );

    return [
      ...tabRows,
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
