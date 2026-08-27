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
 * Whether a directory entry is a style file worth reading: a plain file,
 * named `*.css`, not dotfile-hidden. Excludes an editor's own swap/backup
 * files for free — `.foo.css.swp` and `foo.css~` both fail the `.css` suffix
 * check, without needing to know any one editor's naming convention.
 */
function isStyleFile(name: string): boolean {
  return name.endsWith(".css") && !name.startsWith(".");
}

/**
 * Reads every style file in the watched directory into a source UserStyles
 * can parse. Sorted by name for a stable, predictable injection order across
 * runs — the order otherwise reflects nothing but directory-entry timing.
 *
 * A file that fails to read (permissions, a race with an editor's
 * rename-over-save) is skipped rather than aborting the whole scan: one bad
 * file must not blank out every style that still loads. Failing to list the
 * directory at all is the same story one level up — logged, answered with
 * nothing in force, never thrown.
 */
export async function readStyleFiles(dir: string = stylesDir): Promise<UserStyleSource[]> {
  await mkdir(dir, { recursive: true });

  let entries: string[];
  try {
    const found = await readdir(dir, { withFileTypes: true });
    entries = found
      .filter((entry) => entry.isFile() && isStyleFile(entry.name))
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
 */
export async function watchStyleFiles(
  onChange: (sources: UserStyleSource[]) => void,
  dir: string = stylesDir,
): Promise<() => void> {
  await mkdir(dir, { recursive: true });

  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(dir, () => {
    clearTimeout(timer);
    timer = setTimeout(() => void readStyleFiles(dir).then(onChange), DEBOUNCE_MS);
  });

  watcher.on("error", (error) => console.error("kvist: styles watch failed:", error));

  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
