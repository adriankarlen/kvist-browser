import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import { app, type DownloadItem, type Event, type Session, type WebContents } from "electron";
import type { Settings } from "../shared/config";
import type { DownloadState, DownloadStatus } from "../shared/ipc";
import { type RateState, sampleRate, startRate } from "./download-rate";
import { resolveDownloadDir, uniqueSavePath } from "./downloads-path";

/**
 * `updated` fires per chunk, so the snapshot is throttled — but every terminal
 * transition flushes immediately, or the last thing the user sees is a stale
 * byte count.
 */
const THROTTLE_MS = 100;

function isFinished(status: DownloadStatus): boolean {
  return status !== "progressing" && status !== "paused";
}

/**
 * The download list, and the only handler of `will-download`. Downloads belong
 * to the session rather than to a tab — a tab can be closed mid-transfer and
 * the transfer carries on — so this is owned by the app, not by `TabManager`.
 */
export class Downloads {
  #report: (text: string) => void;
  #emit: (downloads: DownloadState[]) => void = () => {};
  #onTabDownload: (contents: WebContents) => void = () => {};
  #items: DownloadState[] = [];
  /**
   * The transfers that can still be stopped. Entries are dropped in `done`:
   * a finished `DownloadItem` is of no further use, and holding one only
   * invites a call into something Chromium has torn down.
   */
  #live = new Map<number, DownloadItem>();
  /** Save paths claimed by transfers that have not landed on disk yet. */
  #reserved = new Set<string>();
  #timer: NodeJS.Timeout | undefined;
  /** Where the user asked for their downloads, if they asked. */
  #configuredDir: string | undefined;
  #nextId = 1;

  /** Told when a transfer cannot be saved where the config asked for. */
  constructor(report: (text: string) => void) {
    this.#report = report;
  }

  /**
   * Must be attached before the first tab can start a transfer, and only once:
   * a second handler would fight this one over the save path. The list is
   * session-scoped and outlives any window, which is why this is not the
   * window's to attach — the observers below are.
   */
  /** Where transfers are saved; the next one picks it up. */
  applySettings(config: { settings: Pick<Settings, "downloadDir"> }): void {
    this.#configuredDir = config.settings.downloadDir;
  }

  attach(session: Session): void {
    session.on("will-download", (_event, item, webContents) => {
      this.#adopt(item);
      // A `target="_blank"` download has already cost us a tab that will never
      // paint, because the window-open handler cannot know a URL is a download.
      if (webContents !== null && !webContents.isDestroyed()) this.#onTabDownload(webContents);
    });
  }

  /** Full snapshots to the chrome, as `TabManager` does for tabs. */
  observe(emit: (downloads: DownloadState[]) => void): void {
    this.#emit = emit;
  }

  /** Which webContents asked, so a tab opened only for a download can be closed. */
  observeTabDownload(handler: (contents: WebContents) => void): void {
    this.#onTabDownload = handler;
  }

  /** The snapshot as it stands, newest first. */
  get list(): DownloadState[] {
    return this.#items;
  }

  /** `:downloads.clear` — drops everything that has stopped moving, and says how many. */
  clear(): number {
    const before = this.#items.length;
    this.#items = this.#items.filter((entry) => !isFinished(entry.status));
    this.#flush();
    return before - this.#items.length;
  }

  /**
   * Stops one transfer. Unknown ids and anything that has already stopped are
   * no-ops rather than errors — the chrome's list is a snapshot, and a download
   * can finish between the row being drawn and the button being clicked.
   */
  cancel(id: number): void {
    this.#live.get(id)?.cancel();
  }

  /**
   * `:downloads.cancel [n]` — the nth row as the panel shows it, 1-based, or
   * the newest transfer still moving when no row is named. The panel shows no
   * ids, so a position is the only thing a user can actually point at.
   */
  cancelNth(n?: number): void {
    const entry =
      n === undefined ? this.#items.find((row) => !isFinished(row.status)) : this.#items[n - 1];
    if (entry !== undefined) this.cancel(entry.id);
  }

  #directory(): string {
    const dir = resolveDownloadDir({
      configured: this.#configuredDir,
      env: process.env.XDG_DOWNLOAD_DIR,
      // Chromium reads `user-dirs.dirs` for this on Linux, and answers $HOME
      // when that file names no download directory.
      fallback: app.getPath("downloads"),
      home: homedir(),
    });
    // A configured directory that does not exist yet would otherwise surface as
    // an interrupted download with nothing saying why.
    try {
      mkdirSync(dir, { recursive: true });
    } catch (error) {
      this.#report(`could not create the download directory ${dir}: ${String(error)}`);
    }
    return dir;
  }

  #adopt(item: DownloadItem): void {
    // A transfer in flight occupies `<savePath>.crdownload`, not `savePath`, so
    // disk alone cannot tell that a name is taken — two concurrent downloads of
    // one filename would both pick it and the second would clobber the first.
    // The reservation stands in until the file itself does.
    const savePath = uniqueSavePath(
      this.#directory(),
      item.getFilename(),
      (path) => this.#reserved.has(path) || existsSync(path),
    );
    this.#reserved.add(savePath);
    // From here until the listeners are attached, a throw would strand the
    // reservation with no `done` to release it — acquisition and its release
    // belong side by side.
    try {
      // Setting the path is what suppresses Chromium's save dialog; there is no
      // themeable dialog to show instead, and a TUI browser should not sprout a
      // native one.
      item.setSavePath(savePath);
      this.#track(item, savePath);
    } catch (error) {
      this.#rollback(item, savePath);
      throw error;
    }
  }

  /**
   * Undoes a partial adoption. No `done` handler made it on, so no terminal
   * cleanup will ever fire: this is the only release of anything `#track`
   * claimed. Cancelling also stops Chromium writing to a path we no longer
   * track.
   */
  #rollback(item: DownloadItem, savePath: string): void {
    item.removeAllListeners("updated");
    item.removeAllListeners("done");
    const id = this.#nextId - 1;
    if (this.#live.get(id) === item) this.#live.delete(id);
    const url = item.getURL();
    this.#items = this.#items.filter((entry) => entry.url !== url);
    this.#reserved.delete(savePath);
    item.cancel();
    this.#flush();
  }

  #track(item: DownloadItem, savePath: string): void {
    const entry: DownloadState = {
      id: this.#nextId++,
      filename: basename(savePath),
      url: item.getURL(),
      status: "progressing",
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      bytesPerSecond: 0,
    };
    this.#items = [entry, ...this.#items];
    this.#live.set(entry.id, item);
    this.#flush();

    let rate: RateState = startRate(entry.receivedBytes, Date.now());

    // The listeners die with the item: `done` is terminal, and it drops the
    // pair so a long session does not accumulate handlers on torn-down items.
    const release = (): void => {
      item.removeListener("updated", onUpdated);
      item.removeListener("done", onDone);
    };
    const onUpdated = (_event: Event, state: "progressing" | "interrupted"): void => {
      // Chromium reports a pause as `isPaused`, not as a state of its own, so
      // the list's `paused` is ours to derive.
      const status: DownloadStatus = state === "progressing" && item.isPaused() ? "paused" : state;
      entry.status = status;
      entry.receivedBytes = item.getReceivedBytes();
      entry.totalBytes = item.getTotalBytes();
      rate = sampleRate(rate, entry.receivedBytes, Date.now());
      // A paused transfer is not a slow one; leave the average alone, but do
      // not claim it is still moving.
      entry.bytesPerSecond = status === "paused" ? 0 : rate.rate;
      this.#schedule();
    };
    const onDone = (
      _event: Event,
      // `done` never reports `paused`; a paused transfer reports on resume.
      state: Exclude<DownloadStatus, "paused">,
    ): void => {
      // Only now is the filesystem the authority on this name: a completed
      // download has become the file, and a failed one has left it free.
      release();
      this.#reserved.delete(savePath);
      this.#live.delete(entry.id);
      entry.status = state;
      entry.receivedBytes = item.getReceivedBytes();
      entry.totalBytes = item.getTotalBytes();
      entry.bytesPerSecond = 0;
      this.#flush();
    };
    item.on("updated", onUpdated);
    item.once("done", onDone);
  }

  #schedule(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setTimeout(() => this.#flush(), THROTTLE_MS);
  }

  #flush(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#emit([...this.#items]);
  }
}
