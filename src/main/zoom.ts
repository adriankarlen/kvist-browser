import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
   * Flushes any pending write synchronously and stops the debounce timer. A
   * `will-quit` must not let a queued write get dropped on the floor.
   */
  release(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    if (this.#pending) void this.#writeNow();
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
    this.#lastWrite = this.#write(snapshot);
    await this.#lastWrite;
  }

  async #write(snapshot: Record<string, number>): Promise<void> {
    await mkdir(this.#dir, { recursive: true });
    const target = join(this.#dir, ZOOM_FILE);
    // Write to a temp file then rename, so a crash mid-write cannot leave a
    // truncated zoom.json that boots into an empty map.
    const tmp = `${target}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
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
