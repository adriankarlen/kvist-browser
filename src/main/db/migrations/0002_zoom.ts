import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/** Per-origin zoom levels (0 = 100%), the way Electron counts them. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TABLE zoom (origin TEXT PRIMARY KEY, level REAL NOT NULL)`;
});
