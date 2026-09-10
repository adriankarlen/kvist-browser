import { watch } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { stylesDir } from "./paths";
import type { UserStyleSource } from "./user-styles";

// Editors rename over the file rather than writing in place, so a single save
// can surface as several directory events. Same value as config.ts's watcher,
// for the same reason.
const DEBOUNCE_MS = 50;

/**
 * Whether a directory entry is a style file worth reading: `*.css`, not
 * dotfile-hidden, and a plain file or symlink to one — dotfile repos
 * symlink into `~/.config`, where `isFile()` is false. Editor swap files
 * fail the `.css` suffix (`foo.css~`).
 */
function isStyleFile(entry: {
  name: string;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}): boolean {
  return (
    (entry.isFile() || entry.isSymbolicLink()) &&
    entry.name.endsWith(".css") &&
    !entry.name.startsWith(".")
  );
}

/**
 * Reads every style file, sorted by name so the injection order is stable
 * across runs. Never rejects: an unreadable file is skipped — one bad file
 * must not blank out the rest; an unlistable directory is logged, nothing
 * in force.
 */
export async function readStyleFiles(dir: string = stylesDir): Promise<UserStyleSource[]> {
  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    console.error("kvist: could not create the styles directory:", error);
    return [];
  }

  let entries: string[];
  try {
    const found = await readdir(dir, { withFileTypes: true });
    entries = found
      .filter((entry) => isStyleFile(entry))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    console.error("kvist: could not list the styles directory:", error);
    return [];
  }

  const sources = await Promise.all(
    entries.map(async (name): Promise<UserStyleSource | null> => {
      const path = join(dir, name);
      try {
        return { id: path, source: await readFile(path, "utf8") };
      } catch (error) {
        console.error(`kvist: could not read ${name}:`, error);
        return null;
      }
    }),
  );

  return sources.filter((source) => source !== null);
}

/**
 * Watches the styles directory, returning a release like `watchConfig`. A
 * directory watch, not per-file: rename-over-save needs no inode watch.
 * Changes trigger a full rescan — diffing buys nothing. An unwatchable
 * directory yields a no-op release, not a rejection.
 */
export async function watchStyleFiles(
  onChange: (sources: UserStyleSource[]) => void,
  dir: string = stylesDir,
  // Injectable purely for tests: the real race this guards against — release
  // landing between the debounced rescan starting and it resolving — is too
  // narrow a window to hit reliably against the real filesystem.
  read: (dir: string) => Promise<UserStyleSource[]> = readStyleFiles,
  // Injectable purely for tests, same reason: `fs.watch` throwing
  // synchronously (an inotify-watch limit, say) is not practical to
  // reproduce against the real filesystem.
  watchDir: typeof watch = watch,
): Promise<() => void> {
  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    console.error("kvist: could not create the styles directory:", error);
    return () => {};
  }

  // Set once release has run, so a rescan already in flight when the window
  // closes does not call back into a teardown UserStyles instance. Clearing
  // the timer alone only stops a rescan that has not started yet.
  let released = false;
  // Bumped on every debounced fire, and captured by the rescan it starts. Two
  // rescans can be in flight together — clearing the timer only cancels a
  // fire that has not happened yet, not a read() already underway — and
  // resolution order is not guaranteed to match start order. Applying a
  // result whose revision has fallen behind would overwrite newer state with
  // older.
  let revision = 0;
  let timer: NodeJS.Timeout | undefined;

  let watcher: ReturnType<typeof watch>;
  try {
    watcher = watchDir(dir, () => {
      clearTimeout(timer);
      const thisRevision = ++revision;
      timer = setTimeout(() => {
        void read(dir)
          .then((sources) => {
            if (!released && thisRevision === revision) onChange(sources);
          })
          // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejection reason is unknown; it is only logged
          .catch((error: unknown) => console.error("kvist: could not reload styles:", error));
      }, DEBOUNCE_MS);
    });
  } catch (error) {
    // `fs.watch` can throw synchronously — an inotify-watch limit, or the
    // directory vanishing between the `mkdir` above and this call. A styles
    // watcher that never starts must not be the reason the rest of startup
    // (the config watcher's `will-quit`, the zoom store's flush, `activate`)
    // never runs either, so this fails the same way an unmakeable directory
    // does: logged, answered with a no-op release.
    console.error("kvist: could not watch the styles directory:", error);
    return () => {};
  }

  watcher.on("error", (error) => console.error("kvist: styles watch failed:", error));

  return () => {
    released = true;
    clearTimeout(timer);
    watcher.close();
  };
}
