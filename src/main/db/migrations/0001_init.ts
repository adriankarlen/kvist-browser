import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/**
 * Two rows per URL in `bookmarks` and `history` are intentional: a reload is
 * its own visit, and bookmarking a page twice is the user's call.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      origin TEXT,
      visited_at INTEGER NOT NULL
    )
  `;
  yield* sql`CREATE INDEX history_visited_at ON history (visited_at DESC)`;
  yield* sql`
    CREATE TABLE bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `;
  yield* sql`CREATE INDEX bookmarks_url ON bookmarks (url)`;
  yield* sql`
    CREATE TABLE session (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      tabs_json TEXT NOT NULL,
      active_index INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      x INTEGER,
      y INTEGER,
      orientation TEXT,
      saved_at INTEGER NOT NULL
    )
  `;
});
