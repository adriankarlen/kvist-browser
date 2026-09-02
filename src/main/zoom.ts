import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { App } from "electron";
import { configDir } from "./paths";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The Electron zoom API works in levels, where 0 is the original size and
 * each +1 / -1 is a 20% step (factor = 1.2 ^ level). The documented default
 * limits clamp between 50% and 300%, which is what we honour.
 */
export const STEP = 1;
/** The user-visible maximum Chromium actually accepts is a touch above 300% and below 50%. */
const FLOOR = -2.8;
const CEILING = 5.7;
const DEBOUNCE_MS = 250;
const ZOOM_FILE = "zoom.json";

/**
 * Per-origin zoom levels, persisted to `~/.config/kvist/zoom.json`. App-scoped
 * like `Downloads` and `Permissions`: a tab's zoom level belongs to the
 * origin it is on, not to any one window.
 *
 * Writes are debounced — a Ctrl-wheel nudge can fire many `zoom-changed`
 * events in quick succession — and a pending write is flushed on `release()`,
 * so a quit cannot lose a level that is in flight.
 */
export class ZoomStore {
  #levels = new Map<string, number>();
  #pending = false;
  #released = false;
  #timer: NodeJS.Timeout | undefined;
  #lastWrite: Promise<void> = Promise.resolve();
  /** The directory the file lives in — passed in so tests can point at a tmpdir. */
  #dir: string;

  constructor(dir: string = configDir) {
    this.#dir = dir;
  }

  /**
   * Reads the saved levels. A missing file is the empty map, not an error; a
   * malformed file is logged and treated as empty, so a half-edited JSON
   * never boots the user into a state where zoom does not work.
   */
  static async load(dir: string = configDir): Promise<ZoomStore> {
    const store = new ZoomStore(dir);
    try {
      const raw = await readFile(join(dir, ZOOM_FILE), "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (isObject(parsed)) {
        for (const [origin, value] of Object.entries(parsed)) {
          if (isFiniteNumber(value)) {
            store.#levels.set(origin, clamp(value));
          }
        }
      }
    } catch (error) {
      // SAFETY: readFile rejects with a Node system error, which carries `code`.
      const { code } = error as NodeJS.ErrnoException;
      if (code !== "ENOENT") console.error("kvist: could not read zoom.json:", error);
    }
    return store;
  }

  /** The saved level for an origin, or 0 when there is none. */
  get(origin: string): number {
    return this.#levels.get(origin) ?? 0;
  }

  /**
   * Records the new level for an origin. The in-memory map is updated
   * synchronously — `get` reflects the change straight away — and a write is
   * scheduled.
   */
  set(origin: string, level: number): void {
    this.#levels.set(origin, clamp(level));
    this.#schedule();
  }

  /**
   * Writes any queued levels to disk and stops the debounce timer. The write
   * is `writeFileSync`, not the async path, because the only caller is
   * `will-quit`: an async write there has to hold the quit open to finish,
   * and holding the quit open is what broke the app (see `flushOnQuit`).
   * A store is done after this — later `set` calls still update the map but
   * never reach the disk.
   */
  release(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#released = true;
    if (this.#pending) this.#writeSync();
  }

  /** Awaits the latest queued write — tests use this to assert on disk state. */
  async flushed(): Promise<void> {
    await this.#lastWrite;
  }

  #schedule(): void {
    this.#pending = true;
    if (this.#timer !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#writeNow();
    }, DEBOUNCE_MS);
  }

  async #writeNow(): Promise<void> {
    this.#pending = false;
    const snapshot = Object.fromEntries(this.#levels);
    // Writes serialize through #lastWrite: every writer shares the one tmp
    // path, so a write starting while another is still on the fs would race
    // it — a timer flush overlapping a quit flush would rename over the
    // other's half-written file.
    this.#lastWrite = this.#lastWrite.then(() => this.#write(snapshot));
    await this.#lastWrite;
  }

  /**
   * The quit-time write. Its own temp path, because a debounced write that
   * fired a moment before `release()` can still be mid-`writeFile` on the
   * shared one; sharing the path would have the two stamp on each other.
   */
  #writeSync(): void {
    this.#pending = false;
    const target = join(this.#dir, ZOOM_FILE);
    const tmp = `${target}.quit.tmp`;
    try {
      mkdirSync(this.#dir, { recursive: true });
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.#levels), null, 2), "utf8");
      renameSync(tmp, target);
    } catch (error) {
      console.error("kvist: could not write zoom.json:", error);
    }
  }

  async #write(snapshot: Record<string, number>): Promise<void> {
    const target = join(this.#dir, ZOOM_FILE);
    // Write to a temp file then rename, so a crash mid-write cannot leave a
    // truncated zoom.json that boots into an empty map.
    const tmp = `${target}.tmp`;
    // mkdir lives inside the try so a failure here — like any other fs
    // failure — is logged rather than rejecting #lastWrite, which release()'s
    // fire-and-forget call would otherwise leave unhandled and poisoned for
    // every later flushed().
    try {
      await mkdir(this.#dir, { recursive: true });
      await writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
      // This snapshot was taken before release() wrote the map out, so
      // renaming it over the quit-time file would put back a state the user
      // has already moved on from.
      if (this.#released) return;
      await rename(tmp, target);
    } catch (error) {
      console.error("kvist: could not write zoom.json:", error);
    }
  }
}

/** Levels outside Chromium's accepted range are pinned at the nearest edge. */
export function clamp(level: number): number {
  if (level < FLOOR) return FLOOR;
  if (level > CEILING) return CEILING;
  return level;
}

/**
 * Hooks `will-quit` so a write queued inside the debounce window still lands
 * before the process exits. The whole flush is synchronous, so the quit is
 * never cancelled.
 *
 * This used to `preventDefault()` the quit, await the write, then call
 * `app.quit()` again — and that re-armed quit is silently dropped when it
 * lands on the same tick as the `will-quit` that cancelled it. With no
 * queued write the flush promise is already resolved, so that was the
 * *common* path: the app cancelled its own quit, never re-armed, and sat in
 * the dock with its database already closed by an earlier `will-quit`
 * handler. The next dock click hit `activate` and threw a DrizzleQueryError
 * out of `Session.load`.
 *
 * Documented limitation: Electron does not emit `will-quit` at all on Windows
 * system shutdown, restart and logout, so the flush never runs there — the
 * write is best-effort in that window no matter what this does.
 */
export function flushOnQuit(app: Pick<App, "on">, store: ZoomStore): void {
  app.on("will-quit", () => store.release());
}
