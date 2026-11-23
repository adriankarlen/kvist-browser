import { Clock, Context, Effect, Layer, PubSub, Schema, Stream } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Bookmark } from "../../shared/schema/bookmarks";
import { clampLimit, DEFAULT_LIMIT, escapeLike } from "../db/query";
import { epochMillis, nonEmptyString, parse, urlString } from "../db/validation";

export const BookmarkRow = Bookmark;

export type BookmarkRow = Bookmark;

const AddRow = Schema.Struct({ url: urlString, title: nonEmptyString, createdAt: epochMillis });

/** `createdAt` defaults to now; an explicit `null` is malformed, not "not provided". */
export interface AddInput {
  readonly url: string;
  readonly title: string;
  readonly createdAt?: number;
}

const Search = Schema.Struct({ like: Schema.String, limit: Schema.Int });
const Id = Schema.Struct({ id: Schema.Int });

function isId(id: number): boolean {
  return Number.isInteger(id) && id >= 1;
}

export class BookmarksRepo extends Context.Service<
  BookmarksRepo,
  {
    /** Not deduplicating: bookmarking a page twice is two rows, on purpose. */
    readonly add: (input: AddInput) => Effect.Effect<boolean>;
    readonly remove: (id: number) => Effect.Effect<boolean>;
    /** Drops every bookmark for the URL, and says how many there were. */
    readonly removeUrl: (url: string) => Effect.Effect<number>;
    readonly get: (id: number) => Effect.Effect<BookmarkRow | null>;
    readonly has: (url: string) => Effect.Effect<boolean>;
    /** Every bookmarked URL, once each, for anything that marks pages as bookmarked. */
    readonly urls: Effect.Effect<ReadonlySet<string>>;
    /** URL or title substring, newest first. `%`, `_` and `\` match literally. */
    readonly search: (pattern: string, limit?: number) => Effect.Effect<ReadonlyArray<BookmarkRow>>;
    readonly list: (limit?: number) => Effect.Effect<ReadonlyArray<BookmarkRow>>;
    /** One element per write that changed a row; writes that changed nothing stay quiet. */
    readonly changes: Stream.Stream<void>;
  }
>()("kvist/BookmarksRepo") {
  static layer = Layer.effect(
    BookmarksRepo,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const changed = yield* Effect.acquireRelease(PubSub.unbounded<void>(), PubSub.shutdown);
      const notify = PubSub.publish(changed, undefined);
      const columns = sql`id, url, title, created_at`;

      const searchRows = SqlSchema.findAll({
        Request: Search,
        Result: BookmarkRow,
        execute: ({ like, limit }) => sql`
          SELECT ${columns} FROM bookmarks
          WHERE url LIKE ${like} ESCAPE '\\' OR title LIKE ${like} ESCAPE '\\'
          ORDER BY created_at DESC, id DESC LIMIT ${limit}
        `,
      });

      const listRows = SqlSchema.findAll({
        Request: Schema.Int,
        Result: BookmarkRow,
        execute: (limit) =>
          sql`SELECT ${columns} FROM bookmarks ORDER BY created_at DESC, id DESC LIMIT ${limit}`,
      });

      const byId = SqlSchema.findAll({
        Request: Schema.Int,
        Result: BookmarkRow,
        execute: (id) => sql`SELECT ${columns} FROM bookmarks WHERE id = ${id}`,
      });

      const deleted = SqlSchema.findAll({
        Request: Schema.Union([
          Schema.Struct({ id: Schema.Int }),
          Schema.Struct({ url: Schema.String }),
        ]),
        Result: Id,
        execute: (where) =>
          "id" in where
            ? sql`DELETE FROM bookmarks WHERE id = ${where.id} RETURNING id`
            : sql`DELETE FROM bookmarks WHERE url = ${where.url} RETURNING id`,
      });

      const urlRows = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({ url: Schema.String }),
        execute: () => sql`SELECT DISTINCT url FROM bookmarks`,
      });

      const logged =
        <B>(what: string, fallback: B) =>
        <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A | B> =>
          effect.pipe(
            Effect.catchCause((cause) => Effect.as(Effect.logError(what, cause), fallback)),
          );

      const removeWhere = (where: { readonly id: number } | { readonly url: string }) =>
        deleted(where).pipe(
          Effect.tap((rows) => (rows.length > 0 ? notify : Effect.void)),
          Effect.map((rows) => rows.length),
          logged("could not remove a bookmark", 0),
        );

      const service: BookmarksRepo["Service"] = {
        add: (input) =>
          Effect.gen(function* () {
            const createdAt =
              input.createdAt === undefined ? yield* Clock.currentTimeMillis : input.createdAt;

            const validated = parse(AddRow, { ...input, createdAt });

            if (validated.problem !== undefined) return false;
            yield* sql`INSERT INTO bookmarks ${sql.insert(validated.value)}`;
            yield* notify;

            return true;
          }).pipe(logged("could not add a bookmark", false)),
        remove: (id) =>
          isId(id) ? Effect.map(removeWhere({ id }), (n) => n > 0) : Effect.succeed(false),
        removeUrl: (url) =>
          parse(urlString, url).problem === undefined ? removeWhere({ url }) : Effect.succeed(0),
        get: (id) =>
          isId(id)
            ? byId(id).pipe(
                Effect.map((rows) => rows[0] ?? null),
                logged("could not read a bookmark", null),
              )
            : Effect.succeed(null),
        has: (url) =>
          parse(urlString, url).problem === undefined
            ? sql`SELECT 1 FROM bookmarks WHERE url = ${url} LIMIT 1`.pipe(
                Effect.map((rows) => rows.length > 0),
                logged("could not read bookmarks", false),
              )
            : Effect.succeed(false),
        urls: urlRows(undefined).pipe(
          Effect.map((rows): ReadonlySet<string> => new Set(rows.map((row) => row.url))),
          logged("could not read bookmarks", new Set<string>()),
        ),
        search: (pattern, limit = DEFAULT_LIMIT) =>
          parse(nonEmptyString, pattern).problem === undefined
            ? searchRows({ like: `%${escapeLike(pattern)}%`, limit: clampLimit(limit) }).pipe(
                logged("could not search bookmarks", []),
              )
            : Effect.succeed([]),
        list: (limit = DEFAULT_LIMIT) =>
          listRows(clampLimit(limit)).pipe(logged("could not list bookmarks", [])),
        changes: Stream.fromPubSub(changed),
      };

      return service;
    }),
  );
}
