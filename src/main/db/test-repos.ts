import { Effect, Layer, ManagedRuntime } from "effect";
import type { Context } from "effect";
import { SqlClient } from "effect/sql";
import { testDatabase } from "./database";

export interface RepoRunner<S> {
  /** Runs one repository call to completion; `node:sqlite` is synchronous. */
  readonly run: <A>(call: (repo: S) => Effect.Effect<A>) => A;
  /** Raw SQL on the same database, for planting rows a repo would refuse to write. */
  readonly sql: (statement: (sql: SqlClient.SqlClient) => Effect.Effect<unknown, unknown>) => void;
  readonly dispose: () => void;
}

/** A repository over a fresh in-memory database, called like plain functions in tests. */
export function repoRunner<I, S, E>(
  tag: Context.Key<I, S>,
  layer: Layer.Layer<I, E, SqlClient.SqlClient>,
): RepoRunner<S> {
  const runtime = ManagedRuntime.make(layer.pipe(Layer.provideMerge(testDatabase)));

  return {
    run: (call) => runtime.runSync(Effect.flatMap(Effect.service(tag), call)),
    sql: (statement) => {
      runtime.runSync(Effect.flatMap(Effect.service(SqlClient.SqlClient), statement));
    },
    dispose: () => Effect.runSync(runtime.disposeEffect),
  };
}
