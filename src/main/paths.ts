import { homedir } from "node:os";
import { join } from "node:path";
import { app } from "electron";

const APP_DIR = "kvist";

/**
 * Resolves an XDG base directory path, falling back to the conventional
 * location under $HOME if the environment variable is unset or empty.
 * Appends the Kvist app directory to the resolved base.
 */
function xdg(variable: string, fallback: string): string {
  const base = process.env[variable];
  return join(base && base !== "" ? base : join(homedir(), fallback), APP_DIR);
}

/** Hand-edited config lives here; Kvist only ever reads from it. */
export const configDir = xdg("XDG_CONFIG_HOME", ".config");

/**
 * Hand-written UserCSS files live here, watched and live-reloaded (KVI-22).
 * A subdirectory of configDir rather than a setting of its own — same as
 * config.css/config.toml, this is a fixed, hand-edited location, not
 * something worth a settings key.
 */
export const stylesDir = join(configDir, "styles");

/**
 * Where the SQLite database lives (KVI-24). Resolved before `applyXdgPaths`
 * runs, so the value is `XDG_DATA_HOME/kvist` (or the conventional fallback)
 * regardless of where Electron's profile would otherwise land. Exposed as a
 * path string so tests can point the storage at a tmpdir without going
 * through `app.getPath`.
 */
export const dataDir = xdg("XDG_DATA_HOME", join(".local", "share"));

/** The single file the storage layer owns. Phase 6's tables live inside it. */
export const dbPath = join(dataDir, "kvist.db");

/**
 * Electron puts userData under XDG_CONFIG_HOME on Linux, so Chromium's profile
 * state would bury the hand-edited config that belongs there. Keeps
 * ~/.config/kvist free for the user. Must run before app ready.
 *
 * Chromium's caches stay inside the profile directory: Electron derives them
 * from sessionData and ignores both --disk-cache-dir and the `cache` path.
 */
export function applyXdgPaths(): void {
  app.setPath("userData", dataDir);
  app.setPath("sessionData", dataDir);
  app.setPath("crashDumps", join(xdg("XDG_CACHE_HOME", ".cache"), "crashpad"));
}
