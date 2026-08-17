import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import { app, type DownloadItem, type Session, type WebContents } from "electron";
import type { DownloadState, DownloadStatus } from "../shared/ipc";
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
  #emit: (downloads: DownloadState[]) => void = () => {};
  #onTabDownload: (contents: WebContents) => void = () => {};
  #items: DownloadState[] = [];
  /** Save paths claimed by transfers that have not landed on disk yet. */
  #reserved = new Set<string>();
  #timer: NodeJS.Timeout | undefined;
  /** Reassigned from the config, like `TabManager.homepage`. */
  configuredDir: string | undefined;
  #nextId = 1;

  /**
   * Must be attached before the first tab can start a transfer, and only once:
   * a second handler would fight this one over the save path. The list is
   * session-scoped and outlives any window, which is why this is not the
   * window's to attach — the observers below are.
   */
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

  /** `:downloads.clear` — drops everything that has stopped moving. */
  clear(): void {
    this.#items = this.#items.filter((entry) => !isFinished(entry.status));
    this.#flush();
  }

  #directory(): string {
    const dir = resolveDownloadDir({
      configured: this.configuredDir,
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
      console.error(`kvist: could not create download directory ${dir}:`, error);
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
    // Setting the path is what suppresses Chromium's save dialog; there is no
    // themeable dialog to show instead, and a TUI browser should not sprout a
    // native one.
    item.setSavePath(savePath);

    const entry: DownloadState = {
      id: this.#nextId++,
      filename: basename(savePath),
      url: item.getURL(),
      status: "progressing",
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
    };
    this.#items = [entry, ...this.#items];
    this.#flush();

    item.on("updated", (_event, state) => {
      entry.status = state;
      entry.receivedBytes = item.getReceivedBytes();
      entry.totalBytes = item.getTotalBytes();
      this.#schedule();
    });

    item.on("done", (_event, state) => {
      // Only now is the filesystem the authority on this name: a completed
      // download has become the file, and a failed one has left it free.
      this.#reserved.delete(savePath);
      entry.status = state;
      entry.receivedBytes = item.getReceivedBytes();
      entry.totalBytes = item.getTotalBytes();
      this.#flush();
    });
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
