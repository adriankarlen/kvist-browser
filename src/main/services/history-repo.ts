import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { originOf } from "../../shared/url";
import { clampLimit, DEFAULT_LIMIT, escapeLike } from "../db/query";
import { epochMillis, nonEmptyString, parse, urlString } from "../db/validation";
import { errorPageTarget } from "../error-page";

export const HistoryRow = Schema.Struct({
  id: Schema.Int,
  url: Schema.String,
  title: Schema.String,
  origin: Schema.NullOr(Schema.String),
  visitedAt: Schema.Int,
});

export type HistoryRow = typeof HistoryRow.Type;

const RecordInput = Schema.Struct({
  url: urlString,
  title: nonEmptyString,
  visitedAt: epochMillis,
});

export type RecordInput = typeof RecordInput.Type;

const Search = Schema.Struct({ like: Schema.String, limit: Schema.Int });

export class HistoryRepo extends Context.Service<
  HistoryRepo,
  {
    /**
     * Appends one visit, or returns false: error-page wrappers, opaque
     * origins (`data:`, `blob:`) and invalid input are skipped on purpose,
     * because they have no place in a URL search.
     */
    readonly record: (input: RecordInput) => Effect.Effect<boolean>;
    /** URL or title substring, newest first. `%`, `_` and `\` match literally. */
    readonly search: (pattern: string, limit?: number) => Effect.Effect<ReadonlyArray<HistoryRow>>;
    readonly recent: (limit?: number) => Effect.Effect<ReadonlyArray<HistoryRow>>;
  }
>()("kvist/HistoryRepo") {
  static layer = Layer.effect(
    HistoryRepo,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const columns = sql`id, url, title, origin, visited_at`;

      const searchRows = SqlSchema.findAll({
        Request: Search,
        Result: HistoryRow,
        execute: ({ like, limit }) => sql`
          SELECT ${columns} FROM history
          WHERE url LIKE ${like} ESCAPE '\\' OR title LIKE ${like} ESCAPE '\\'
          ORDER BY visited_at DESC, id DESC LIMIT ${limit}
        `,
      });

      const recentRows = SqlSchema.findAll({
        Request: Schema.Int,
        Result: HistoryRow,
        execute: (limit) =>
          sql`SELECT ${columns} FROM history ORDER BY visited_at DESC, id DESC LIMIT ${limit}`,
      });

      const orNothing = <A>(effect: Effect.Effect<ReadonlyArray<A>, unknown>) =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Effect.as(Effect.logError("history query failed", cause), []),
          ),
        );

      return {
        record: (input) => {
          const validated = parse(RecordInput, input);

          if (validated.problem !== undefined) return Effect.succeed(false);
          const { url, title, visitedAt } = validated.value;
          const origin = originOf(url);

          if (origin === null || errorPageTarget(url) !== null) return Effect.succeed(false);

          return sql`INSERT INTO history ${sql.insert({ url, title, origin, visitedAt })}`.pipe(
            Effect.as(true),
            Effect.catchCause((cause) =>
              Effect.as(Effect.logError("could not record a visit", cause), false),
            ),
          );
        },
        search: (pattern, limit = DEFAULT_LIMIT) => {
          if (parse(nonEmptyString, pattern).problem !== undefined) return Effect.succeed([]);

          return orNothing(
            searchRows({ like: `%${escapeLike(pattern)}%`, limit: clampLimit(limit) }),
          );
        },
        recent: (limit = DEFAULT_LIMIT) => orNothing(recentRows(clampLimit(limit))),
      };
    }),
  );
}
