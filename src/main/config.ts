import { watch } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_SETTINGS, type Problem, type Settings, type UserConfig } from "../shared/config";
import { configDir } from "./paths";
import { parseSettings } from "./settings";

const CSS_FILE = "config.css";
const TOML_FILE = "config.toml";

// Editors rename over the file rather than writing in place, so a single save
// can surface as several directory events.
const DEBOUNCE_MS = 50;

/**
 * Everything config reading owns: the last settings that parsed. Session
 * state belonging to the file — a syntax error mid-edit keeps these rather
 * than reverting to the defaults. Explicit instead of a module-level `let`,
 * so `load`/`watch` take the store they mutate rather than reaching for
 * shared state, and a test can hold two of them.
 */
export interface ConfigStore {
  lastGood: Settings;
}

export function createConfigStore(): ConfigStore {
  return { lastGood: DEFAULT_SETTINGS };
}

async function read(file: string): Promise<string> {
  try {
    return await readFile(join(configDir, file), "utf8");
  } catch (error) {
    // SAFETY: readFile rejects with a Node system error, which carries `code`.
    const { code } = error as NodeJS.ErrnoException;
    if (code !== "ENOENT") console.error(`kvist: could not read ${file}:`, error);
    return "";
  }
}

/** A config and everything wrong with it; the caller decides who is told. */
export interface LoadedConfig {
  config: UserConfig;
  problems: Problem[];
}

/** How a problem reads to a user: which file, which field, and why. */
export function describeProblem({ field, reason }: Problem): string {
  // A problem with the file itself names the file as its field; saying so
  // twice reads as a bug.
  const where = field === TOML_FILE ? TOML_FILE : `${TOML_FILE}: ${field}`;
  return `${where}: ${reason}`;
}

export async function loadConfig(store: ConfigStore): Promise<LoadedConfig> {
  const [css, toml] = await Promise.all([read(CSS_FILE), read(TOML_FILE)]);
  const { settings, problems } = parseSettings(toml, store.lastGood);
  store.lastGood = settings;
  return { config: { css, settings }, problems };
}

/**
 * Acquires the config watcher and returns its release. A watcher is a
 * resource with a lifecycle — the handle and the debounce timer both outlive
 * any single event — so acquire/release is the shape of the API, not a
 * fire-and-forget `void`. Watches the directory rather than the files, so
 * saves that replace the inode still register.
 */
export async function watchConfig(
  store: ConfigStore,
  onChange: (loaded: LoadedConfig) => void,
): Promise<() => void> {
  await mkdir(configDir, { recursive: true });

  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(configDir, (_event, filename) => {
    if (filename !== CSS_FILE && filename !== TOML_FILE) return;
    clearTimeout(timer);
    timer = setTimeout(() => void loadConfig(store).then(onChange), DEBOUNCE_MS);
  });

  watcher.on("error", (error) => console.error("kvist: config watch failed:", error));

  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
