import { watch } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";
import {
  DEFAULT_SETTINGS,
  type NewtabLink,
  type Settings,
  type UserConfig,
} from "../shared/config";
import { configDir } from "./paths";

const CSS_FILE = "config.css";
const TOML_FILE = "config.toml";

// Editors rename over the file rather than writing in place, so a single save
// can surface as several directory events.
const DEBOUNCE_MS = 50;

async function read(file: string): Promise<string> {
  try {
    return await readFile(join(configDir, file), "utf8");
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code !== "ENOENT") console.error(`kvist: could not read ${file}:`, error);
    return "";
  }
}

function asTable(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function parseLinks(value: unknown): NewtabLink[] {
  if (!Array.isArray(value)) return DEFAULT_SETTINGS.newtabLinks;
  const links = value.flatMap((entry) => {
    const { name, url } = asTable(entry);
    return typeof name === "string" && typeof url === "string" ? [{ name, url }] : [];
  });
  // All-or-nothing, like the other fields: one malformed entry falls back to
  // the defaults rather than silently dropping links.
  return links.length === value.length ? links : DEFAULT_SETTINGS.newtabLinks;
}

// Intl only accepts IANA names; "UTC±n" is handled by the clock itself.
const UTC_RX = /^UTC\s*([+-])\s*(\d+)$/i;

function parseTimezone(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    console.error("kvist: ignoring non-string newtab timezone");
    return undefined;
  }
  const timezone = value.trim();
  if (UTC_RX.test(timezone)) return timezone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return timezone;
  } catch {
    console.error(`kvist: ignoring invalid newtab timezone "${timezone}"`);
    return undefined;
  }
}

// A save mid-edit shouldn't throw away the user's whole layout, so a syntax
// error keeps the last settings that parsed rather than reverting to defaults.
let lastGood = DEFAULT_SETTINGS;

function parseSettings(source: string): Settings {
  if (source.trim() === "") {
    lastGood = DEFAULT_SETTINGS;
    return lastGood;
  }

  let parsed: unknown;
  try {
    parsed = parse(source);
  } catch (error) {
    console.error(`kvist: keeping previous settings, ${TOML_FILE} is invalid:`, error);
    return lastGood;
  }

  const root = asTable(parsed);
  const tabs = asTable(root.tabs);
  const newtab = asTable(root.newtab);
  const { adblock, homepage } = root;
  const { orientation } = tabs;
  const focusPage = tabs["focus-page"];

  lastGood = {
    homepage: typeof homepage === "string" ? homepage : DEFAULT_SETTINGS.homepage,
    newtabLinks: parseLinks(newtab.links),
    newtabTimezone: parseTimezone(newtab.timezone),
    adblock: typeof adblock === "boolean" ? adblock : DEFAULT_SETTINGS.adblock,
    tabOrientation:
      orientation === "horizontal" || orientation === "vertical"
        ? orientation
        : DEFAULT_SETTINGS.tabOrientation,
    tabFocusPage: typeof focusPage === "boolean" ? focusPage : DEFAULT_SETTINGS.tabFocusPage,
  };
  return lastGood;
}

export async function loadConfig(): Promise<UserConfig> {
  const [css, toml] = await Promise.all([read(CSS_FILE), read(TOML_FILE)]);
  return { css, settings: parseSettings(toml) };
}

/** Watches the directory rather than the files, so saves that replace the inode still register. */
export async function watchConfig(onChange: (config: UserConfig) => void): Promise<void> {
  await mkdir(configDir, { recursive: true });

  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(configDir, (_event, filename) => {
    if (filename !== CSS_FILE && filename !== TOML_FILE) return;
    clearTimeout(timer);
    timer = setTimeout(() => void loadConfig().then(onChange), DEBOUNCE_MS);
  });

  watcher.on("error", (error) => console.error("kvist: config watch failed:", error));
}
