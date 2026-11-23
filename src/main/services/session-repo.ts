import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { parse } from "../db/validation";

/** What a relaunch restores: the tabs, which one was active, and the window. */
export interface SessionState {
  tabs: string[];
  activeIndex: number;
  width: number;
  height: number;
  x: number | null;
  y: number | null;
}

const Int = Schema.Int;
const NonNegative = Int.check(Schema.isGreaterThanOrEqualTo(0));
const Positive = Int.check(Schema.isGreaterThan(0));

/** Non-empty tab URLs; producers already pass `externalProtocolTarget`. */
const Urls = Schema.NonEmptyArray(Schema.NonEmptyString);

const activeWithinTabs = Schema.makeFilter(
  (state: { readonly tabs: ReadonlyArray<string>; readonly activeIndex: number }) =>
    state.activeIndex < state.tabs.length || "activeIndex within tabs.length",
);

const SaveInput = Schema.Struct({
  tabs: Urls,
  activeIndex: NonNegative,
  width: Positive,
  height: Positive,
  x: Schema.NullOr(Int),
  y: Schema.NullOr(Int),
  savedAt: NonNegative,
}).check(activeWithinTabs);

/**
 * The stored row, decoded into a state the restore path can use. A row from
 * an older build, or one a crash left half-written, fails here and reads as
 * a first launch.
 */
const StoredSession = Schema.Struct({
  tabsJson: Schema.fromJsonString(Urls),
  activeIndex: NonNegative,
  width: Positive,
  height: Positive,
  x: Schema.NullOr(Int),
  y: Schema.NullOr(Int),
});

export class SessionRepo extends Context.Service<
  SessionRepo,
  {
    /** One saved session, overwritten on every save. Invalid input is dropped, not thrown. */
    readonly save: (state: SessionState, savedAt: number) => Effect.Effect<boolean>;
    readonly clear: Effect.Effect<void>;
    /** The saved session, or null when there is none or it no longer decodes. */
    readonly load: Effect.Effect<SessionState | null>;
  }
>()("kvist/SessionRepo") {
  static layer = Layer.effect(
    SessionRepo,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const rows = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Unknown,
        execute: () => sql`
          SELECT tabs_json, active_index, width, height, x, y
          FROM session WHERE id = 1
        `,
      });

      return {
        save: (state, savedAt) => {
          const validated = parse(SaveInput, { ...state, savedAt });

          if (validated.problem !== undefined) return Effect.succeed(false);
          const { tabs, ...rest } = validated.value;
          const row = { id: 1, tabsJson: JSON.stringify(tabs), ...rest };

          return sql`
            INSERT INTO session ${sql.insert(row)}
            ON CONFLICT (id) DO UPDATE SET
              tabs_json = excluded.tabs_json, active_index = excluded.active_index,
              width = excluded.width, height = excluded.height, x = excluded.x, y = excluded.y,
              saved_at = excluded.saved_at
          `.pipe(
            Effect.as(true),
            Effect.catchCause((cause) =>
              Effect.as(Effect.logError("could not save the session", cause), false),
            ),
          );
        },
        clear: sql`DELETE FROM session WHERE id = 1`.pipe(
          Effect.asVoid,
          Effect.catchCause((cause) => Effect.logError("could not clear the saved session", cause)),
        ),
        load: rows(undefined).pipe(
          Effect.map((found) => {
            const stored = parse(StoredSession, found[0]);

            if (stored.problem !== undefined) return null;
            const { tabsJson, ...rest } = stored.value;

            if (rest.activeIndex >= tabsJson.length) return null;

            return { tabs: [...tabsJson], ...rest };
          }),
          Effect.catchCause((cause) =>
            Effect.as(Effect.logError("could not read the saved session", cause), null),
          ),
        ),
      };
    }),
  );
}
