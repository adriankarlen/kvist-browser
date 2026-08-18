import { parse } from "smol-toml";
import {
  DEFAULT_SETTINGS,
  type NewtabLink,
  type Problem,
  type Settings,
  type TabOrientation,
} from "../shared/config";

/**
 * What one parse produced: the settings to use, and everything wrong with the
 * file. Parsing never logs and never throws — a config is hand-edited and
 * hot-reloaded, so half of it being wrong must still leave a usable browser.
 */
export interface ParsedSettings {
  settings: Settings;
  problems: Problem[];
}

/**
 * The rule every field follows: an absent value is not a problem, it is the
 * default. Only a value the user actually wrote and we could not use is worth
 * telling them about.
 */
function coerce<T>(
  value: unknown,
  is: (candidate: unknown) => candidate is T,
  spec: { field: string; fallback: T; reason: string },
  problems: Problem[],
): T {
  if (value === undefined) return spec.fallback;
  if (is(value)) return value;
  problems.push({ field: spec.field, reason: spec.reason });
  return spec.fallback;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isOrientation(value: unknown): value is TabOrientation {
  return value === "horizontal" || value === "vertical";
}

function asTable(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

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
  const named = coerce<string | undefined>(
    value,
    isString,
    { field: "newtab.timezone", fallback: undefined, reason: "not a string" },
    problems,
  );
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
  const tabs = asTable(root.tabs);
  const newtab = asTable(root.newtab);
  const downloads = asTable(root.downloads);

  const settings: Settings = {
    homepage: coerce(
      root.homepage,
      isString,
      { field: "homepage", fallback: DEFAULT_SETTINGS.homepage, reason: "not a string" },
      problems,
    ),
    newtabLinks: parseLinks(newtab.links, problems),
    newtabTimezone: parseTimezone(newtab.timezone, problems),
    adblock: coerce(
      root.adblock,
      isBoolean,
      { field: "adblock", fallback: DEFAULT_SETTINGS.adblock, reason: "not true or false" },
      problems,
    ),
    tabOrientation: coerce(
      tabs.orientation,
      isOrientation,
      {
        field: "tabs.orientation",
        fallback: DEFAULT_SETTINGS.tabOrientation,
        reason: 'not "horizontal" or "vertical"',
      },
      problems,
    ),
    tabFocusPage: coerce(
      tabs["focus-page"],
      isBoolean,
      {
        field: "tabs.focus-page",
        fallback: DEFAULT_SETTINGS.tabFocusPage,
        reason: "not true or false",
      },
      problems,
    ),
    // Undefined falls back to the XDG download directory; `downloads.ts` resolves it.
    downloadDir: coerce<string | undefined>(
      downloads.dir,
      isString,
      { field: "downloads.dir", fallback: undefined, reason: "not a string" },
      problems,
    ),
  };

  return { settings, problems };
}
