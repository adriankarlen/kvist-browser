import { eq } from "drizzle-orm";
import { type } from "arktype";
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
      // arktype decodes it into the shape we can actually use here.
      const validated = parse(urlListValidator, JSON.parse(row.tabsJson));
      if (validated.problem !== undefined) return null;
      urls = validated.value;
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

/**
 * Tab URLs are anything `loadURL` accepts — producers already pass
 * `externalProtocolTarget` — so a non-empty string array suffices.
 *
 * The cross-field narrow mirrors `load()`: an empty entry or bad index
 * would make a row the load path drops, leaving nothing restored.
 */
const inputValidator = type({
  tabs: "string[] > 0",
  activeIndex: "number.integer >= 0",
  width: "number.integer > 0",
  height: "number.integer > 0",
  x: "number.integer | null",
  y: "number.integer | null",
  orientation: "'horizontal' | 'vertical' | null",
  savedAt: "number.integer >= 0",
}).narrow((value, ctx) => {
  if (value.tabs.some((entry) => entry === "")) {
    return ctx.mustBe("non-empty tab URL");
  }
  if (value.activeIndex >= value.tabs.length) {
    return ctx.mustBe("activeIndex within tabs.length");
  }
  return true;
});

/**
 * The decoded JSON column's shape: non-empty array of non-empty strings.
 * `> 0` enforces non-empty; the `narrow` rejects empty entries that
 * would otherwise sneak through `loadURL` with surprising results.
 */
const urlListValidator = type("string[] > 0").narrow((value, ctx) => {
  for (const entry of value) {
    if (entry === "") return ctx.mustBe("non-empty string array");
  }
  return true;
});
