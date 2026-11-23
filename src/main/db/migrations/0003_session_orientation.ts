import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/** The tab orientation flip is gone; the layout lives in config.toml now. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE session DROP COLUMN orientation`;
});
