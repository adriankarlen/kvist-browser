import { parse } from "smol-toml";
import {
  DEFAULT_SETTINGS,
  type NewtabLink,
  type Problem,
  type Settings,
  type TabOrientation,
} from "../shared/config";

const ORIENTATIONS: readonly TabOrientation[] = ["horizontal", "vertical"];

/**
 * What one parse produced: the settings to use, and everything wrong with the
 * file. Parsing never logs and never throws — a config is hand-edited and
 * hot-reloaded, so half of it being wrong must still leave a usable browser.
 */
export interface ParsedSettings {
  settings: Settings;
  problems: Problem[];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** Anything claiming to be a TOML table: a plain, non-list object. */
function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The rule every read* function below follows: an absent value is not a
 * problem, it is the default. Only a value the user actually wrote and we
 * could not use is worth telling them about.
 */
function readString<T extends string | undefined>(
  value: unknown,
  field: string,
  fallback: T,
  problems: Problem[],
): string | T {
  if (value === undefined) return fallback;
  if (isString(value)) return value;
  problems.push({ field, reason: "not a string" });
  return fallback;
}

function readBoolean(
  value: unknown,
  field: string,
  fallback: boolean,
  problems: Problem[],
): boolean {
  if (value === undefined) return fallback;
  if (isBoolean(value)) return value;
  problems.push({ field, reason: "not true or false" });
  return fallback;
}

function readOption<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
  fallback: T,
  problems: Problem[],
): T {
  if (value === undefined) return fallback;
  // SAFETY: membership in `allowed` is the parse — T is exactly that set of strings.
  const hit = allowed.includes(value as T) ? (value as T) : undefined;
  if (hit !== undefined) return hit;
  problems.push({ field, reason: `not ${allowed.map((option) => `"${option}"`).join(" or ")}` });
  return fallback;
}

function asTable(value: unknown): Record<string, unknown> {
  return isTable(value) ? value : {};
}

/**
 * A `[section]` of the file. Written as anything but a table it has no fields
 * to read, so it is reported once rather than as every child of it quietly
 * defaulting.
 */
function section(value: unknown, field: string, problems: Problem[]): Record<string, unknown> {
  if (value === undefined) return {};
  if (isTable(value)) return value;
  problems.push({ field, reason: "not a table" });
  return {};
}

/**
 * The newtab.links array from TOML: each entry must be a table with "name"
 * and "url" string fields.
 */
function parseLinks(value: unknown, problems: Problem[]): NewtabLink[] {
  if (value === undefined) return DEFAULT_SETTINGS.newtabLinks;
  if (!Array.isArray(value)) {
    problems.push({ field: "newtab.links", reason: "not a list of { name, url } tables" });
    return DEFAULT_SETTINGS.newtabLinks;
  }

  const links = value.flatMap((entry) => {
    const { name, url } = asTable(entry);
    return isString(name) && isString(url) ? [{ name, url }] : [];
  });
  // All-or-nothing: one malformed entry falls back to the defaults rather than
  // silently dropping a link the user can still see in their file.
  if (links.length !== value.length) {
    problems.push({ field: "newtab.links", reason: "an entry is missing a name or a url" });
    return DEFAULT_SETTINGS.newtabLinks;
  }
  return links;
}

// Intl only accepts IANA names; "UTC±n" is handled by the clock itself.
const UTC_RX = /^UTC\s*([+-])\s*(\d+)$/i;

function parseTimezone(value: unknown, problems: Problem[]): string | undefined {
  const named = readString(value, "newtab.timezone", undefined, problems);
  if (named === undefined) return undefined;

  const timezone = named.trim();
  if (UTC_RX.test(timezone)) return timezone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return timezone;
  } catch {
    problems.push({ field: "newtab.timezone", reason: `not a timezone: "${timezone}"` });
    return undefined;
  }
}

/**
 * A search URL template is only useful with somewhere to put the query, so
 * one without `{q}` is reported and the default stands.
 */
function parseSearchUrl(value: unknown, problems: Problem[]): string {
  const template = readString(value, "search", DEFAULT_SETTINGS.searchUrl, problems);
  if (template.includes("{q}")) return template;
  problems.push({ field: "search", reason: 'no "{q}" placeholder' });
  return DEFAULT_SETTINGS.searchUrl;
}

/**
 * Reads config.toml. Pure: the previous settings come in as an argument, so a
 * syntax error mid-edit can keep them without anything holding state between
 * calls.
 */
export function parseSettings(
  source: string,
  previous: Settings = DEFAULT_SETTINGS,
): ParsedSettings {
  if (source.trim() === "") return { settings: DEFAULT_SETTINGS, problems: [] };

  let parsed: unknown;
  try {
    parsed = parse(source);
  } catch (error) {
    // A save mid-edit shouldn't throw away the user's whole layout, so the last
    // settings that parsed stand rather than reverting to the defaults.
    const reason = error instanceof Error ? error.message : String(error);
    return { settings: previous, problems: [{ field: "config.toml", reason }] };
  }

  const problems: Problem[] = [];
  const root = asTable(parsed);
  const tabs = section(root.tabs, "tabs", problems);
  const newtab = section(root.newtab, "newtab", problems);
  const downloads = section(root.downloads, "downloads", problems);

  const settings: Settings = {
    homepage: readString(root.homepage, "homepage", DEFAULT_SETTINGS.homepage, problems),
    searchUrl: parseSearchUrl(root.search, problems),
    newtabLinks: parseLinks(newtab.links, problems),
    newtabTimezone: parseTimezone(newtab.timezone, problems),
    adblock: readBoolean(root.adblock, "adblock", DEFAULT_SETTINGS.adblock, problems),
    tabOrientation: readOption(
      tabs.orientation,
      "tabs.orientation",
      ORIENTATIONS,
      DEFAULT_SETTINGS.tabOrientation,
      problems,
    ),
    tabFocusPage: readBoolean(
      tabs["focus-page"],
      "tabs.focus-page",
      DEFAULT_SETTINGS.tabFocusPage,
      problems,
    ),
    // Undefined falls back to the XDG download directory; `downloads.ts` resolves it.
    downloadDir: readString(downloads.dir, "downloads.dir", undefined, problems),
  };

  return { settings, problems };
}
