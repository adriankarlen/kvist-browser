import { Result, Schema } from "effect";
import { Toml } from "effect/encoding";
import {
  DEFAULT_RECIPE,
  DEFAULT_SETTINGS,
  type InputMode,
  type NewtabLink,
  type Problem,
  type Settings,
} from "../shared/config";
import { InputMode as InputModeSchema, RecipeName } from "../shared/schema/config";
import {
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

export type Table = Readonly<Record<string, unknown>>;

/** Anything claiming to be a TOML table: a plain, non-list object. */
export function isTable(value: unknown): value is Table {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One field, decoded on its own so a bad value costs only itself. An absent
 * value is the default, not a problem: only something the user wrote and we
 * could not use is worth telling them about.
 */
export function read<A, F>(
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
export function section(value: unknown, field: string, problems: Problem[]): Table {
  if (value === undefined) return {};

  if (isTable(value)) return value;
  problems.push({ field, reason: "not a table" });

  return {};
}

const Link = Schema.Struct({ name: Schema.String, url: Schema.String });

/**
 * All-or-nothing: one malformed entry falls back to the base list rather than
 * silently dropping a link the user can still see in their file.
 */
function parseLinks(
  value: unknown,
  fallback: ReadonlyArray<NewtabLink>,
  problems: Problem[],
): ReadonlyArray<NewtabLink> {
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

function parseTimezone(
  value: unknown,
  fallback: string | undefined,
  problems: Problem[],
): string | undefined {
  const named = read(value, "newtab.timezone", Schema.String, "not a string", undefined, problems);

  if (named === undefined) return fallback;
  const timezone = named.trim();

  if (isTimezone(timezone)) return timezone;
  problems.push({ field: "newtab.timezone", reason: `not a timezone: "${timezone}"` });

  return fallback;
}

/** A search URL template is only useful with somewhere to put the query. */
export const SearchTemplate = Schema.String.check(
  Schema.makeFilter((template: string) => template.includes("{q}")),
);

function parseSearchUrl(value: unknown, fallback: string, problems: Problem[]): string {
  if (value !== undefined && !Schema.is(Schema.String)(value)) {
    problems.push({ field: "search", reason: "not a string" });

    return fallback;
  }

  return read(value, "search", SearchTemplate, 'no "{q}" placeholder', fallback, problems);
}

const quoted = (names: ReadonlyArray<string>): string => names.map((n) => `"${n}"`).join(", ");

const CssLength = Schema.String.check(
  Schema.makeFilter((size: string) => /^\d+(\.\d+)?(px|ch|em|rem|%|vw|vh)$/.test(size.trim())),
);

const PLACEMENT_KEYS: ReadonlyArray<string> = ["region", "order", "size", "visible", "autohide"];

export function reportUnknownKeys(
  table: Table,
  field: string,
  known: ReadonlyArray<string>,
  problems: Problem[],
): void {
  for (const key of Object.keys(table)) {
    if (!known.includes(key)) {
      problems.push({
        field: `${field}.${key}`,
        reason: `unknown key; expected ${quoted(known)}`,
      });
    }
  }
}

const INPUT_MODES: ReadonlyArray<InputMode> = InputModeSchema.literals;

export function parseInputMode(
  value: unknown,
  fallback: InputMode,
  problems: Problem[],
): InputMode {
  const table = section(value, "input", problems);

  reportUnknownKeys(table, "input", ["mode"], problems);

  return read(
    table.mode,
    "input.mode",
    InputModeSchema,
    `not one of ${quoted(INPUT_MODES)}`,
    fallback,
    problems,
  );
}

function parseRegion(id: ElementId, value: unknown, fallback: Region, problems: Problem[]): Region {
  const field = `layout.${id}.region`;
  const { regions } = SUPPORT[id];
  const named = read(value, field, Region, `not one of ${quoted(REGIONS)}`, fallback, problems);

  if (regions.includes(named)) return named;
  problems.push({
    field,
    reason: `"${named}" is not supported for ${id} yet; use ${quoted(regions)}`,
  });

  return fallback;
}

function parseAutohide(
  id: ElementId,
  value: unknown,
  fallback: boolean,
  problems: Problem[],
): boolean {
  const field = `layout.${id}.autohide`;
  const autohide = read(value, field, Schema.Boolean, "not true or false", fallback, problems);

  if (!autohide || SUPPORT[id].autohide) return autohide;
  problems.push({ field, reason: `${id} cannot auto-hide` });

  return fallback;
}

function parsePlacement(
  id: ElementId,
  value: unknown,
  fallback: Placement,
  problems: Problem[],
): Placement {
  const field = `layout.${id}`;
  const table = section(value, field, problems);

  reportUnknownKeys(table, field, PLACEMENT_KEYS, problems);

  const region = parseRegion(id, table.region, fallback.region, problems);

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
    autohide: parseAutohide(id, table.autohide, fallback.autohide, problems),
  };
}

/** `[layout]`, field by field over `base`: a table that sets only `size` keeps the base's region. */
export function parseLayout(value: unknown, base: Layout, problems: Problem[]): Layout {
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

  const placement = (id: ElementId): Placement => parsePlacement(id, table[id], base[id], problems);

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
 * The recipe config.toml names. Read on its own, ahead of `parseSettings`,
 * because the recipe supplies the base those settings are parsed over. A
 * file that does not parse keeps `previous`; `parseSettings` reports why.
 */
export function readRecipeName(source: string, previous: string): ParsedRecipeName {
  if (source.trim() === "") return { name: DEFAULT_RECIPE, problems: [] };

  const parsed = Toml.parse(source);

  if (Result.isFailure(parsed)) return { name: previous, problems: [] };
  const problems: Problem[] = [];

  const name = read(
    parsed.success.recipe,
    "recipe",
    RecipeName,
    'not a recipe name: lowercase letters, digits and "-"',
    DEFAULT_RECIPE,
    problems,
  );

  return { name, problems };
}

export interface ParsedRecipeName {
  name: string;
  problems: Problem[];
}

/**
 * Reads config.toml over `base`, the defaults with the recipe's applied.
 * Pure: the previous settings come in as an argument, so a syntax error
 * mid-edit can keep them without anything holding state between calls.
 */
export function parseSettings(
  source: string,
  previous: Settings = DEFAULT_SETTINGS,
  base: Settings = DEFAULT_SETTINGS,
): ParsedSettings {
  if (source.trim() === "") return { settings: base, problems: [] };

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
    // Already resolved: `readRecipeName` reported a bad name, and an unknown one falls back.
    recipe: base.recipe,
    homepage: read(root.homepage, "homepage", string, "not a string", base.homepage, problems),
    searchUrl: parseSearchUrl(root.search, base.searchUrl, problems),
    newtabLinks: parseLinks(newtab.links, base.newtabLinks, problems),
    newtabTimezone: parseTimezone(newtab.timezone, base.newtabTimezone, problems),
    adblock: read(root.adblock, "adblock", boolean, "not true or false", base.adblock, problems),
    layout: parseLayout(root.layout, base.layout, problems),
    tabFocusPage: read(
      tabs["focus-page"],
      "tabs.focus-page",
      boolean,
      "not true or false",
      base.tabFocusPage,
      problems,
    ),
    inputMode: parseInputMode(root.input, base.inputMode, problems),
    // Undefined falls back to the XDG download directory; `downloads.ts` resolves it.
    downloadDir: read(
      downloads.dir,
      "downloads.dir",
      string,
      "not a string",
      base.downloadDir,
      problems,
    ),
  };

  return { settings, problems };
}
