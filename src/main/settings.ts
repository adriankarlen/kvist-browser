import { Result, Schema } from "effect";
import { Toml } from "effect/encoding";
import { DEFAULT_SETTINGS, type NewtabLink, type Problem, type Settings } from "../shared/config";
import {
  DEFAULT_LAYOUT,
  ELEMENT_IDS,
  type ElementId,
  type Layout,
  type Placement,
  REGIONS,
  SUPPORT,
} from "../shared/layout";
import { ElementId as ElementIdSchema, Region } from "../shared/schema/layout";

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
function parseLinks(value: unknown, problems: Problem[]): ReadonlyArray<NewtabLink> {
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

const quoted = (names: ReadonlyArray<string>): string => names.map((n) => `"${n}"`).join(", ");

const CssLength = Schema.String.check(
  Schema.makeFilter((size: string) => /^\d+(\.\d+)?(px|ch|em|rem|%|vw|vh)$/.test(size.trim())),
);

const PLACEMENT_KEYS: ReadonlyArray<string> = ["region", "order", "size", "visible", "autohide"];

function reportUnknownKeys(table: Table, field: string, problems: Problem[]): void {
  for (const key of Object.keys(table)) {
    if (!PLACEMENT_KEYS.includes(key)) {
      problems.push({
        field: `${field}.${key}`,
        reason: `unknown key; expected ${quoted(PLACEMENT_KEYS)}`,
      });
    }
  }
}

function parseRegion(id: ElementId, value: unknown, problems: Problem[]): Region {
  const field = `layout.${id}.region`;
  const fallback = DEFAULT_LAYOUT[id].region;
  const { regions } = SUPPORT[id];
  const named = read(value, field, Region, `not one of ${quoted(REGIONS)}`, fallback, problems);

  if (regions.includes(named)) return named;
  problems.push({
    field,
    reason: `"${named}" is not supported for ${id} yet; use ${quoted(regions)}`,
  });

  return fallback;
}

function parseAutohide(id: ElementId, value: unknown, problems: Problem[]): boolean {
  const field = `layout.${id}.autohide`;
  const fallback = DEFAULT_LAYOUT[id].autohide;
  const autohide = read(value, field, Schema.Boolean, "not true or false", fallback, problems);

  if (!autohide || SUPPORT[id].autohide) return autohide;
  problems.push({ field, reason: `${id} cannot auto-hide` });

  return fallback;
}

function parsePlacement(id: ElementId, value: unknown, problems: Problem[]): Placement {
  const field = `layout.${id}`;
  const fallback = DEFAULT_LAYOUT[id];
  const table = section(value, field, problems);

  reportUnknownKeys(table, field, problems);

  const region = parseRegion(id, table.region, problems);

  const order = read(
    table.order,
    `${field}.order`,
    Schema.Int,
    "not a whole number",
    fallback.order,
    problems,
  );

  const size = read(
    table.size,
    `${field}.size`,
    CssLength,
    'not a CSS length like "30ch" or "240px"',
    fallback.size,
    problems,
  );

  const visible = read(
    table.visible,
    `${field}.visible`,
    Schema.Boolean,
    "not true or false",
    fallback.visible,
    problems,
  );

  return {
    region,
    order,
    size: size?.trim(),
    visible,
    autohide: parseAutohide(id, table.autohide, problems),
  };
}

function parseLayout(value: unknown, problems: Problem[]): Layout {
  const table = section(value, "layout", problems);
  const isElement = Schema.is(ElementIdSchema);

  for (const key of Object.keys(table)) {
    if (!isElement(key)) {
      problems.push({
        field: `layout.${key}`,
        reason: `not a layout element; expected ${quoted(ELEMENT_IDS)}`,
      });
    }
  }

  const placement = (id: ElementId): Placement => parsePlacement(id, table[id], problems);

  return {
    tabs: placement("tabs"),
    omnibox: placement("omnibox"),
    bookmarks: placement("bookmarks"),
    downloads: placement("downloads"),
    status: placement("status"),
    find: placement("find"),
    completion: placement("completion"),
  };
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

  if (tabs.orientation !== undefined) {
    problems.push({
      field: "tabs.orientation",
      reason: 'removed; use [layout.tabs] region = "left" (or "top", "bottom", "right")',
    });
  }

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
    layout: parseLayout(root.layout, problems),
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
