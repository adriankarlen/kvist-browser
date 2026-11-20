import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { clamp } from "../zoom";

const Level = Schema.Struct({ level: Schema.Finite });

export class ZoomRepo extends Context.Service<
  ZoomRepo,
  {
    /** The origin's saved level, or 0 (100%) when it has none. */
    readonly get: (origin: string) => Effect.Effect<number>;
    /** Saves a level, clamped to what Chromium accepts. A non-finite level is ignored. */
    readonly set: (origin: string, level: number) => Effect.Effect<void>;
    /** Every saved level, for loading into the model at startup. */
    readonly all: Effect.Effect<ReadonlyArray<readonly [string, number]>>;
  }
>()("kvist/ZoomRepo") {
  static layer = Layer.effect(
    ZoomRepo,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const levelOf = SqlSchema.findAll({
        Request: Schema.String,
        Result: Level,
        execute: (origin) => sql`SELECT level FROM zoom WHERE origin = ${origin}`,
      });

      return {
        get: (origin) =>
          levelOf(origin).pipe(
            Effect.map((rows) => rows[0]?.level ?? 0),
            Effect.catchCause((cause) =>
              Effect.as(Effect.logError("could not read zoom", cause), 0),
            ),
          ),
        all: SqlSchema.findAll({
          Request: Schema.Void,
          Result: Schema.Struct({ origin: Schema.String, level: Schema.Finite }),
          execute: () => sql`SELECT origin, level FROM zoom`,
        })(undefined).pipe(
          Effect.map((rows) => rows.map(({ origin, level }) => [origin, level] as const)),
          Effect.catchCause((cause) =>
            Effect.as(Effect.logError("could not read zoom", cause), []),
          ),
        ),
        set: (origin, level) =>
          Number.isFinite(level)
            ? sql`
                INSERT INTO zoom ${sql.insert({ origin, level: clamp(level) })}
                ON CONFLICT (origin) DO UPDATE SET level = excluded.level
              `.pipe(
                Effect.asVoid,
                Effect.catchCause((cause) => Effect.logError("could not save zoom", cause)),
              )
            : Effect.void,
      };
    }),
  );
}
