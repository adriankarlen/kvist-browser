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
 * The last settings that parsed. Session state belonging to the file, not to
 * parsing — `parseSettings` takes it as an argument so that a syntax error
 * mid-edit keeps the user's layout without anything hidden holding it.
 */
let lastGood: Settings = DEFAULT_SETTINGS;

async function read(file: string): Promise<string> {
  try {
    return await readFile(join(configDir, file), "utf8");
  } catch (error) {
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

export async function loadConfig(): Promise<LoadedConfig> {
  const [css, toml] = await Promise.all([read(CSS_FILE), read(TOML_FILE)]);
  const { settings, problems } = parseSettings(toml, lastGood);
  lastGood = settings;
  return { config: { css, settings }, problems };
}

/** Watches the directory rather than the files, so saves that replace the inode still register. */
export async function watchConfig(onChange: (loaded: LoadedConfig) => void): Promise<void> {
  await mkdir(configDir, { recursive: true });

  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(configDir, (_event, filename) => {
    if (filename !== CSS_FILE && filename !== TOML_FILE) return;
    clearTimeout(timer);
    timer = setTimeout(() => void loadConfig().then(onChange), DEBOUNCE_MS);
  });

  watcher.on("error", (error) => console.error("kvist: config watch failed:", error));
}
