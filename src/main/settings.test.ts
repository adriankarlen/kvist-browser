import { expect, test } from "vite-plus/test";
import { DEFAULT_SETTINGS, type Settings } from "../shared/config";
import { parseSettings } from "./settings";

const settingsOf = (source: string, previous?: Settings): Settings =>
  parseSettings(source, previous).settings;
const problemsOf = (source: string): string[] =>
  parseSettings(source).problems.map(({ field }) => field);

test("an empty file is the defaults, and says nothing about them", () => {
  expect(parseSettings("")).toEqual({ settings: DEFAULT_SETTINGS, problems: [] });
  expect(parseSettings("   \n\n  ")).toEqual({ settings: DEFAULT_SETTINGS, problems: [] });
});

test("every field is read", () => {
  const settings = settingsOf(`
    homepage = "https://example.com"
    adblock = false

    [tabs]
    orientation = "vertical"
    focus-page = false

    [downloads]
    dir = "~/dl"

    [newtab]
    timezone = "Europe/Stockholm"
    [[newtab.links]]
    name = "docs"
    url = "https://docs.rs"
  `);

  expect(settings).toEqual({
    homepage: "https://example.com",
    adblock: false,
    tabOrientation: "vertical",
    tabFocusPage: false,
    downloadDir: "~/dl",
    newtabTimezone: "Europe/Stockholm",
    newtabLinks: [{ name: "docs", url: "https://docs.rs" }],
  });
});

test("an absent field is not a problem, it is the default", () => {
  expect(parseSettings("homepage = 'https://a.b'").problems).toEqual([]);
  expect(settingsOf("homepage = 'https://a.b'").adblock).toBe(DEFAULT_SETTINGS.adblock);
});

test("a field the user wrote and we could not use is reported", () => {
  expect(problemsOf("homepage = 3")).toEqual(["homepage"]);
  expect(problemsOf("adblock = 'yes'")).toEqual(["adblock"]);
  expect(problemsOf("[tabs]\norientation = 'sideways'")).toEqual(["tabs.orientation"]);
  expect(problemsOf("[tabs]\nfocus-page = 1")).toEqual(["tabs.focus-page"]);
  expect(problemsOf("[downloads]\ndir = true")).toEqual(["downloads.dir"]);
});

test("an unusable field falls back rather than being fatal", () => {
  const settings = settingsOf("homepage = 3\nadblock = 'yes'\n[tabs]\norientation = 'sideways'");
  expect(settings.homepage).toBe(DEFAULT_SETTINGS.homepage);
  expect(settings.adblock).toBe(DEFAULT_SETTINGS.adblock);
  expect(settings.tabOrientation).toBe(DEFAULT_SETTINGS.tabOrientation);
});

test("a syntax error keeps the settings that last parsed", () => {
  const previous: Settings = { ...DEFAULT_SETTINGS, homepage: "https://kept.example" };
  const { settings, problems } = parseSettings("homepage = 'unterminated", previous);

  expect(settings).toBe(previous);
  expect(problems).toHaveLength(1);
  expect(problems[0]?.field).toBe("config.toml");
});

test("links are all-or-nothing, so a half-written entry keeps the defaults", () => {
  const half = `
    [[newtab.links]]
    name = "docs"
    url = "https://docs.rs"
    [[newtab.links]]
    name = "half"
  `;
  expect(settingsOf(half).newtabLinks).toEqual(DEFAULT_SETTINGS.newtabLinks);
  expect(problemsOf(half)).toEqual(["newtab.links"]);
});

test("links that are not a list at all are reported once", () => {
  expect(problemsOf("[newtab]\nlinks = 'github'")).toEqual(["newtab.links"]);
});

test("an empty list of links is a list, not a mistake", () => {
  expect(parseSettings("[newtab]\nlinks = []")).toEqual({
    settings: { ...DEFAULT_SETTINGS, newtabLinks: [] },
    problems: [],
  });
});

test("timezones may be IANA names or UTC offsets", () => {
  expect(settingsOf("[newtab]\ntimezone = 'Europe/Stockholm'").newtabTimezone).toBe(
    "Europe/Stockholm",
  );
  expect(settingsOf("[newtab]\ntimezone = 'UTC+2'").newtabTimezone).toBe("UTC+2");
  expect(settingsOf("[newtab]\ntimezone = '  UTC - 5 '").newtabTimezone).toBe("UTC - 5");
});

test("a timezone that is neither is dropped and reported", () => {
  expect(settingsOf("[newtab]\ntimezone = 'Mars/Olympus'").newtabTimezone).toBeUndefined();
  expect(problemsOf("[newtab]\ntimezone = 'Mars/Olympus'")).toEqual(["newtab.timezone"]);
  expect(problemsOf("[newtab]\ntimezone = 7")).toEqual(["newtab.timezone"]);
});

test("nothing is carried between calls", () => {
  const first: Settings = { ...DEFAULT_SETTINGS, homepage: "https://first.example" };
  parseSettings("homepage = 'unterminated", first);
  // The bad parse above must not have become anyone's previous settings.
  expect(settingsOf("homepage = 'unterminated").homepage).toBe(DEFAULT_SETTINGS.homepage);
});
