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
 * Whether a directory entry is a style file worth reading: named `*.css`,
 * not dotfile-hidden, and either a plain file or a symlink to one — dotfile
 * repos commonly symlink their managed files into `~/.config`, and
 * `Dirent.isFile()` is false for a symlink even when what it points at is a
 * plain file. A symlink to a directory still passes this check and fails at
 * `readFile` instead, which is already handled below the same as any other
 * unreadable file. Excludes an editor's own swap/backup files for free —
 * `.foo.css.swp` and `foo.css~` both fail the `.css` suffix check, without
 * needing to know any one editor's naming convention.
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
 * Reads every style file in the watched directory into a source UserStyles
 * can parse. Sorted by name for a stable, predictable injection order across
 * runs — the order otherwise reflects nothing but directory-entry timing.
 *
 * Never rejects. A file that fails to read (permissions, a race with an
 * editor's rename-over-save) is skipped rather than aborting the whole scan:
 * one bad file must not blank out every style that still loads. Failing to
 * create or list the directory at all is the same story one level up —
 * logged, answered with nothing in force.
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
 * Acquires the styles-directory watcher and returns its release — the same
 * shape as config.ts's watchConfig: the handle and its debounce timer both
 * outlive any single event. Watches the directory rather than individual
 * files, so a file dropped in fresh registers as readily as one that was
 * already there, and an editor's rename-over-save does not need a watch set
 * up under the new inode.
 *
 * A full rescan on every change rather than a diff, like the rest of the
 * config path: working out which one file changed would buy nothing over
 * handing UserStyles a fresh snapshot of everything.
 *
 * A directory that cannot even be created (a stray non-directory file in its
 * place, an unwritable parent) yields a no-op release rather than rejecting:
 * a bad config directory must not be the reason the window never opens.
 */
export async function watchStyleFiles(
  onChange: (sources: UserStyleSource[]) => void,
  dir: string = stylesDir,
  // Injectable purely for tests: the real race this guards against — release
  // landing between the debounced rescan starting and it resolving — is too
  // narrow a window to hit reliably against the real filesystem.
  read: (dir: string) => Promise<UserStyleSource[]> = readStyleFiles,
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
  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(dir, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void read(dir)
        .then((sources) => {
          if (!released) onChange(sources);
        })
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejection reason is unknown; it is only logged
        .catch((error: unknown) => console.error("kvist: could not reload styles:", error));
    }, DEBOUNCE_MS);
  });

  watcher.on("error", (error) => console.error("kvist: styles watch failed:", error));

  return () => {
    released = true;
    clearTimeout(timer);
    watcher.close();
  };
}
