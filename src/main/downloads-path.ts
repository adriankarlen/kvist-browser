import { homedir } from "node:os";
import { extname, join } from "node:path";

/**
 * Where a download lands, and under what name. Kept pure — the Electron side
 * lives in `downloads.ts` — so both decisions are unit-testable: the directory
 * comes from three places that shadow each other, and the name has to dodge
 * whatever is already on disk.
 */

export interface DownloadDirSources {
  /** `[downloads] dir` from config.toml, the user's explicit answer. */
  configured: string | undefined;
  /** `$XDG_DOWNLOAD_DIR`, when the environment sets it. */
  env: string | undefined;
  /** Electron's own download path, which already reads `user-dirs.dirs` on Linux. */
  fallback: string;
  /** The home directory, only to recognise it as a non-answer. See below. */
  home: string;
}

/**
 * Expands tilde notation (~) in a file path to the user's home directory.
 */
function expandTilde(path: string): string {
  if (path === "~") return homedir();
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

/**
 * First of configured, environment, fallback that is set to something.
 *
 * The fallback gets one correction: Chromium answers `$HOME` when
 * `user-dirs.dirs` names no download directory, and dumping files loose in the
 * home directory is not something a browser should do on its own — so that one
 * answer becomes `$HOME/Downloads`, the conventional XDG default.
 */
export function resolveDownloadDir({
  configured,
  env,
  fallback,
  home,
}: DownloadDirSources): string {
  for (const candidate of [configured, env]) {
    const trimmed = candidate?.trim();
    if (trimmed !== undefined && trimmed !== "") return expandTilde(trimmed);
  }
  return fallback === home ? join(home, "Downloads") : fallback;
}

/**
 * A path in `dir` that nothing occupies yet, counting up as Chromium's own
 * download list does. Setting a save path suppresses Chromium's prompt, and
 * with it the collision handling it would have done — so a second copy of the
 * same file would overwrite the first without this.
 */
export function uniqueSavePath(
  dir: string,
  filename: string,
  exists: (path: string) => boolean,
): string {
  const first = join(dir, filename);
  if (!exists(first)) return first;

  // ".tar.gz" counts as ".gz" here, so the suffix lands as "archive.tar-1.gz".
  // Chromium numbers the same way, and splitting on the first dot would break
  // dotfiles instead.
  const extension = extname(filename);
  const stem = filename.slice(0, filename.length - extension.length);

  for (let n = 1; ; n++) {
    const candidate = join(dir, `${stem}-${n}${extension}`);
    if (!exists(candidate)) return candidate;
  }
}
