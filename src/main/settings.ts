import { Result, Schema } from "effect";
import { Toml } from "effect/encoding";
import { DEFAULT_SETTINGS, type NewtabLink, type Problem, type Settings } from "../shared/config";

/**
 * What one parse produced: the settings to use, and everything wrong with the
 * file. Parsing never logs and never throws — a config is hand-edited and
 * hot-reloaded, so half of it being wrong must still leave a usable browser.
 */
export interface ParsedSettings {
  settings: Settings;
  problems: Problem[];
}

type Table = Readonly<Record<string, unknown>>;

/** Anything claiming to be a TOML table: a plain, non-list object. */
function isTable(value: unknown): value is Table {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One field, decoded on its own so a bad value costs only itself. An absent
 * value is the default, not a problem: only something the user wrote and we
 * could not use is worth telling them about.
 */
function read<A, F>(
  value: unknown,
  field: string,
  schema: Schema.Codec<A, unknown>,
  reason: string,
  fallback: F,
  problems: Problem[],
): A | F {
  if (value === undefined) return fallback;
  const decoded = Schema.decodeUnknownResult(schema)(value);

  if (Result.isSuccess(decoded)) return decoded.success;
  problems.push({ field, reason });

  return fallback;
}

/**
 * A `[section]` of the file. Written as anything but a table it has no fields
 * to read, so it is reported once rather than as every child of it quietly
 * defaulting.
 */
function section(value: unknown, field: string, problems: Problem[]): Table {
  if (value === undefined) return {};

  if (isTable(value)) return value;
  problems.push({ field, reason: "not a table" });

  return {};
}

const Link = Schema.Struct({ name: Schema.String, url: Schema.String });

/**
 * All-or-nothing: one malformed entry falls back to the defaults rather than
 * silently dropping a link the user can still see in their file.
 */
function parseLinks(value: unknown, problems: Problem[]): NewtabLink[] {
  const fallback = DEFAULT_SETTINGS.newtabLinks;

  if (value === undefined) return fallback;

  if (!Array.isArray(value)) {
    problems.push({ field: "newtab.links", reason: "not a list of { name, url } tables" });

    return fallback;
  }

  const links = read(
    value,
    "newtab.links",
    Schema.Array(Link),
    "an entry is missing a name or a url",
    undefined,
    problems,
  );

  return links === undefined ? fallback : links.map(({ name, url }) => ({ name, url }));
}

// Intl only accepts IANA names; "UTC±n" is handled by the clock itself.
const UTC_RX = /^UTC\s*([+-])\s*(\d+)$/i;

function isTimezone(name: string): boolean {
  if (UTC_RX.test(name)) return true;

  try {
    new Intl.DateTimeFormat("en", { timeZone: name });

    return true;
  } catch {
    return false;
  }
}

function parseTimezone(value: unknown, problems: Problem[]): string | undefined {
  const named = read(value, "newtab.timezone", Schema.String, "not a string", undefined, problems);

  if (named === undefined) return undefined;
  const timezone = named.trim();

  if (isTimezone(timezone)) return timezone;
  problems.push({ field: "newtab.timezone", reason: `not a timezone: "${timezone}"` });

  return undefined;
}

const SearchTemplate = Schema.String.check(
  Schema.makeFilter((template: string) => template.includes("{q}")),
);

/** A search URL template is only useful with somewhere to put the query. */
function parseSearchUrl(value: unknown, problems: Problem[]): string {
  if (value !== undefined && !Schema.is(Schema.String)(value)) {
    problems.push({ field: "search", reason: "not a string" });

    return DEFAULT_SETTINGS.searchUrl;
  }

  return read(
    value,
    "search",
    SearchTemplate,
    'no "{q}" placeholder',
    DEFAULT_SETTINGS.searchUrl,
    problems,
  );
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

  const parsed = Toml.parse(source);

  // A save mid-edit shouldn't throw away the user's whole layout, so the last
  // settings that parsed stand rather than reverting to the defaults.
  if (Result.isFailure(parsed)) {
    return {
      settings: previous,
      problems: [{ field: "config.toml", reason: parsed.failure.message }],
    };
  }

  const problems: Problem[] = [];
  const root = parsed.success;
  const tabs = section(root.tabs, "tabs", problems);
  const newtab = section(root.newtab, "newtab", problems);
  const downloads = section(root.downloads, "downloads", problems);
  const string = Schema.String;
  const boolean = Schema.Boolean;

  const settings: Settings = {
    homepage: read(
      root.homepage,
      "homepage",
      string,
      "not a string",
      DEFAULT_SETTINGS.homepage,
      problems,
    ),
    searchUrl: parseSearchUrl(root.search, problems),
    newtabLinks: parseLinks(newtab.links, problems),
    newtabTimezone: parseTimezone(newtab.timezone, problems),
    adblock: read(
      root.adblock,
      "adblock",
      boolean,
      "not true or false",
      DEFAULT_SETTINGS.adblock,
      problems,
    ),
    tabOrientation: read(
      tabs.orientation,
      "tabs.orientation",
      Schema.Literals(["horizontal", "vertical"]),
      'not "horizontal" or "vertical"',
      DEFAULT_SETTINGS.tabOrientation,
      problems,
    ),
    tabFocusPage: read(
      tabs["focus-page"],
      "tabs.focus-page",
      boolean,
      "not true or false",
      DEFAULT_SETTINGS.tabFocusPage,
      problems,
    ),
    // Undefined falls back to the XDG download directory; `downloads.ts` resolves it.
    downloadDir: read(downloads.dir, "downloads.dir", string, "not a string", undefined, problems),
  };

  return { settings, problems };
}
