import { eq } from "drizzle-orm";
import { type } from "arktype";
import type { TabOrientation } from "../shared/config";
import type { Database } from "./db/database";
import { session } from "./db/schema";
import { parse } from "./db/validation";

/**
 * What the save path produces and the load path returns. The shape is the
 * one the IPC and `TabManager` care about, not the row — the JSON column is
 * decoded at this seam so a malformed payload fails fast here rather than
 * corrupting the snapshot the chrome renders.
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
 * App-scoped, like `History`: a window's restore state belongs to no other
 * window, and the row is overwritten on every close. Singleton by convention
 * (`id = 1`); the table does not enforce it because Drizzle's `primaryKey`
 * is enough of an invariant for a single writer.
 *
 * `load` is forgiving: a missing row, a malformed JSON column, or a payload
 * that fails the per-field validators all collapse to `null`, so a corrupted
 * row from a previous version of the app cannot brick startup. The session
 * is a "best effort restore", not a contract.
 *
 * `save` validates the input and silently drops failures rather than
 * throwing — the throw site is `win.on("close")`, where an exception would
 * surface to the user as a quit that takes down the window with no session
 * to restore.
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
    return true;
  }

  /**
   * Removes the row. Called when a window closes with no tabs — the user
   * closed everything deliberately, so the next launch should look like a
   * fresh first launch rather than resurrect tabs the user has done with.
   * The close handler is the only caller; `win.on("close")` fires before
   * the window is destroyed, so the DB is still open and writes are safe.
   */
  clear(): void {
    this.#db.drizzle.delete(session).where(eq(session.id, 1)).run();
  }

  /**
   * Returns the persisted state, or `null` when no row exists, when the JSON
   * column does not decode, when the URL list is empty, when the active
   * index is out of range, or when the orientation string is not a known
   * value. Each failure mode collapses to `null` so the startup path can
   * treat "no session" uniformly.
   */
  load(): SessionState | null {
    const rows = this.#db.drizzle
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
 * Save-side validation. Tab URLs are anything `loadURL` would accept — the
 * `navigate` and `setWindowOpenHandler` paths are the only producers and
 * both pass through `externalProtocolTarget` for mailto/tel — so a non-empty
 * string array is sufficient at this seam; deeper URL parsing is the loader's
 * job and outside this layer's scope.
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
