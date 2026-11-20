import { eq } from "drizzle-orm";
import { Schema } from "effect";
import type { TabOrientation } from "../shared/config";
import type { Database } from "./db/database";
import { session } from "./db/schema";
import { parse } from "./db/validation";

/**
 * What the save path produces and the load path returns: the shape IPC and
 * `TabManager` need, not the row. The JSON column is decoded here so a
 * malformed payload fails fast instead of corrupting the snapshot.
 */
export interface SessionState {
  tabs: string[];
  activeIndex: number;
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  orientation: TabOrientation | null;
}

/**
 * App-scoped; the row is overwritten on every close. `load` collapses
 * missing rows, bad JSON, and invalid fields to null, so an old-version row
 * cannot brick startup. `save` drops failures: the call site is
 * `win.on("close")`, where a throw quits unsaved.
 */
export class Session {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  save(state: SessionState, savedAt: number): boolean {
    const validated = parse(inputValidator, { ...state, savedAt });

    if (validated.problem !== undefined) return false;
    const value = validated.value;

    try {
      this.#db.drizzle
        .insert(session)
        .values({
          id: 1,
          tabsJson: JSON.stringify(value.tabs),
          activeIndex: value.activeIndex,
          width: value.width,
          height: value.height,
          x: value.x,
          y: value.y,
          orientation: value.orientation,
          savedAt: value.savedAt,
        })
        .onConflictDoUpdate({
          target: session.id,
          set: {
            tabsJson: JSON.stringify(value.tabs),
            activeIndex: value.activeIndex,
            width: value.width,
            height: value.height,
            x: value.x,
            y: value.y,
            orientation: value.orientation,
            savedAt: value.savedAt,
          },
        })
        .run();
    } catch (error) {
      console.error("kvist: could not save the session:", error);

      return false;
    }

    return true;
  }

  /**
   * Removes the row when a window closes with no tabs — the user is done,
   * so the next launch looks fresh rather than resurrecting closed tabs.
   * Runs in `win.on("close")`, before destruction, so the DB is open.
   */
  clear(): void {
    try {
      this.#db.drizzle.delete(session).where(eq(session.id, 1)).run();
    } catch (error) {
      console.error("kvist: could not clear the saved session:", error);
    }
  }

  /**
   * The persisted state, or null: no row, failed query, undecodable JSON,
   * empty URL list, out-of-range active index, or unknown orientation all
   * collapse to null, so startup can treat "no session" uniformly.
   */
  load(): SessionState | null {
    let rows;

    try {
      rows = this.#db.drizzle
        .select({
          tabsJson: session.tabsJson,
          activeIndex: session.activeIndex,
          width: session.width,
          height: session.height,
          x: session.x,
          y: session.y,
          orientation: session.orientation,
        })
        .from(session)
        .where(eq(session.id, 1))
        .all();
    } catch (error) {
      console.error("kvist: could not read the saved session:", error);

      return null;
    }

    const row = rows[0];

    if (row === undefined) return null;

    let urls: string[];

    try {
      // The JSON column is just bytes as far as SQLite is concerned —
      // Schema decodes it into the shape we can actually use here.
      const validated = parse(urlListValidator, JSON.parse(row.tabsJson));

      if (validated.problem !== undefined) return null;
      urls = [...validated.value];
    } catch {
      return null;
    }

    if (row.activeIndex < 0 || row.activeIndex >= urls.length) return null;

    if (row.width <= 0 || row.height <= 0) return null;

    let orientation: TabOrientation | null = null;

    if (row.orientation !== null) {
      if (row.orientation !== "horizontal" && row.orientation !== "vertical") return null;
      orientation = row.orientation;
    }

    return {
      tabs: urls,
      activeIndex: row.activeIndex,
      width: row.width,
      height: row.height,
      x: row.x,
      y: row.y,
      orientation,
    };
  }
}

/** Non-empty tab URLs; producers already pass `externalProtocolTarget`. */
const urlList = Schema.NonEmptyArray(Schema.NonEmptyString);

const int = Schema.Int;

/**
 * The cross-field check mirrors `load()`: an index past the last tab would
 * make a row the load path drops, leaving nothing restored.
 */
const inputValidator = Schema.Struct({
  tabs: urlList,
  activeIndex: int.check(Schema.isGreaterThanOrEqualTo(0)),
  width: int.check(Schema.isGreaterThan(0)),
  height: int.check(Schema.isGreaterThan(0)),
  x: Schema.NullOr(int),
  y: Schema.NullOr(int),
  orientation: Schema.NullOr(Schema.Literals(["horizontal", "vertical"])),
  savedAt: int.check(Schema.isGreaterThanOrEqualTo(0)),
}).check(
  Schema.makeFilter(
    (value: { tabs: ReadonlyArray<string>; activeIndex: number }) =>
      value.activeIndex < value.tabs.length || "activeIndex within tabs.length",
  ),
);

/** The decoded JSON column's shape. */
const urlListValidator = urlList;
