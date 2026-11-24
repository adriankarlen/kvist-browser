import { describe, expect, test } from "vite-plus/test";
import { DEFAULT_SETTINGS, type Settings } from "../shared/config";
import { DEFAULT_LAYOUT, ELEMENT_IDS } from "../shared/layout";
import { parseSettings, readRecipeName } from "./settings";

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
    search = "https://search.example/?q={q}"
    adblock = false

    [tabs]
    focus-page = false

    [input]
    mode = "standard"

    [layout.tabs]
    region = "left"
    size = "30ch"

    [downloads]
    dir = "~/dl"

    [newtab]
    timezone = "Europe/Stockholm"
    [[newtab.links]]
    name = "docs"
    url = "https://docs.rs"
  `);

  expect(settings).toEqual({
    recipe: "tui",
    homepage: "https://example.com",
    searchUrl: "https://search.example/?q={q}",
    adblock: false,
    layout: {
      ...DEFAULT_LAYOUT,
      tabs: { region: "left", order: 0, size: "30ch", visible: true, autohide: false },
    },
    tabFocusPage: false,
    inputMode: "standard",
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
  expect(problemsOf("search = 3")).toEqual(["search"]);
  expect(problemsOf("adblock = 'yes'")).toEqual(["adblock"]);
  expect(problemsOf("[tabs]\nfocus-page = 1")).toEqual(["tabs.focus-page"]);
  expect(problemsOf("[downloads]\ndir = true")).toEqual(["downloads.dir"]);
});

test("a search template without a {q} placeholder has nowhere to put the query", () => {
  expect(settingsOf("search = 'https://example.com'").searchUrl).toBe(DEFAULT_SETTINGS.searchUrl);
  expect(problemsOf("search = 'https://example.com'")).toEqual(["search"]);
});

test("an unusable field falls back rather than being fatal", () => {
  const settings = settingsOf("homepage = 3\nadblock = 'yes'\n[layout.tabs]\nregion = 'sideways'");
  expect(settings.homepage).toBe(DEFAULT_SETTINGS.homepage);
  expect(settings.adblock).toBe(DEFAULT_SETTINGS.adblock);
  expect(settings.layout).toEqual(DEFAULT_LAYOUT);
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

test("a section written as something other than a table is reported once", () => {
  expect(problemsOf("tabs = 5")).toEqual(["tabs"]);
  expect(problemsOf("newtab = 'links'")).toEqual(["newtab"]);
  expect(problemsOf("downloads = ['~/dl']")).toEqual(["downloads"]);
  // Its fields are gone with it, so the rest of the file still applies.
  expect(settingsOf("homepage = 'https://a.b'\ntabs = 5")).toEqual({
    ...DEFAULT_SETTINGS,
    homepage: "https://a.b",
  });
});

describe("input mode", () => {
  test("is vim when the file says nothing", () => {
    expect(settingsOf("homepage = 'https://a.b'").inputMode).toBe("vim");
    expect(problemsOf("[input]")).toEqual([]);
  });

  test("reads either mode", () => {
    expect(settingsOf("[input]\nmode = 'standard'").inputMode).toBe("standard");
    expect(settingsOf("[input]\nmode = 'vim'").inputMode).toBe("vim");
  });

  test("an unknown mode falls back to vim and is reported", () => {
    expect(settingsOf("[input]\nmode = 'emacs'").inputMode).toBe("vim");
    expect(problemsOf("[input]\nmode = 'emacs'")).toEqual(["input.mode"]);
  });

  test("an unknown key and a non-table are reported", () => {
    expect(problemsOf("[input]\nmode = 'vim'\nleader = ','")).toEqual(["input.leader"]);
    expect(problemsOf("input = 'standard'")).toEqual(["input"]);
  });
});

describe("layout", () => {
  const layoutOf = (source: string) => settingsOf(source).layout;

  test("no [layout] is today's layout", () => {
    expect(layoutOf("homepage = 'https://a.b'")).toEqual(DEFAULT_LAYOUT);
  });

  test("every placement field is read, and the rest of the table keeps its defaults", () => {
    expect(layoutOf("[layout.find]\nregion = 'top'\norder = -1").find).toEqual({
      region: "top",
      order: -1,
      size: undefined,
      visible: true,
      autohide: false,
    });
    expect(layoutOf("[layout.tabs]\nvisible = false").tabs.visible).toBe(false);
    expect(layoutOf("[layout.tabs]\nautohide = true").tabs.autohide).toBe(true);
    expect(layoutOf("[layout.bookmarks]\nsize = ' 12.5rem '").bookmarks.size).toBe("12.5rem");
  });

  test("one bad field costs only itself", () => {
    const source = "[layout.tabs]\nregion = 'right'\norder = 1.5\nsize = 'wide'";

    expect(layoutOf(source).tabs).toEqual({ ...DEFAULT_LAYOUT.tabs, region: "right" });
    expect(problemsOf(source)).toEqual(["layout.tabs.order", "layout.tabs.size"]);
  });

  test("each kind of mistake is reported against its field", () => {
    expect(problemsOf("layout = 1")).toEqual(["layout"]);
    expect(problemsOf("[layout]\nsidebar = {}")).toEqual(["layout.sidebar"]);
    expect(problemsOf("[layout]\ntabs = 'left'")).toEqual(["layout.tabs"]);
    expect(problemsOf("[layout.tabs]\nregoin = 'left'")).toEqual(["layout.tabs.regoin"]);
    expect(problemsOf("[layout.tabs]\nregion = 'middle'")).toEqual(["layout.tabs.region"]);
    expect(problemsOf("[layout.tabs]\nvisible = 'no'")).toEqual(["layout.tabs.visible"]);
    expect(problemsOf("[layout.tabs]\nsize = 30")).toEqual(["layout.tabs.size"]);
    expect(problemsOf("[layout.tabs]\nautohide = 'yes'")).toEqual(["layout.tabs.autohide"]);
  });

  test("a region the element is not built for yet falls back, and says which ones it is", () => {
    const { settings, problems } = parseSettings("[layout.omnibox]\nregion = 'left'");

    expect(settings.layout.omnibox.region).toBe("top");
    expect(problems).toEqual([
      {
        field: "layout.omnibox.region",
        reason: '"left" is not supported for omnibox yet; use "top", "bottom", "floating"',
      },
    ]);
    expect(problemsOf("[layout.tabs]\nregion = 'floating'")).toEqual(["layout.tabs.region"]);
    expect(problemsOf("[layout.completion]\nregion = 'top'")).toEqual(["layout.completion.region"]);
    expect(problemsOf("[layout.downloads]\nregion = 'floating'")).toEqual([
      "layout.downloads.region",
    ]);
  });

  test("the omnibox can sit below the page", () => {
    const { settings, problems } = parseSettings("[layout.omnibox]\nregion = 'bottom'");

    expect(settings.layout.omnibox.region).toBe("bottom");
    expect(problems).toEqual([]);
  });

  test("the omnibox can float, as the command palette", () => {
    const { settings, problems } = parseSettings("[layout.omnibox]\nregion = 'floating'");

    expect(settings.layout.omnibox.region).toBe("floating");
    expect(problems).toEqual([]);
  });

  test("the panels and lines go to any edge", () => {
    for (const id of ["bookmarks", "downloads", "status", "find"] as const) {
      expect(layoutOf(`[layout.${id}]\nregion = 'left'`)[id].region).toBe("left");
      expect(layoutOf(`[layout.${id}]\nregion = 'right'`)[id].region).toBe("right");
    }
  });

  test("every element can be hidden", () => {
    for (const id of ELEMENT_IDS) {
      expect(layoutOf(`[layout.${id}]\nvisible = false`)[id].visible).toBe(false);
      expect(problemsOf(`[layout.${id}]\nvisible = false`)).toEqual([]);
    }
  });

  test("only the tab strip can auto-hide", () => {
    const { settings, problems } = parseSettings("[layout.status]\nautohide = true");

    expect(settings.layout.status.autohide).toBe(false);
    expect(problems).toEqual([
      { field: "layout.status.autohide", reason: "status cannot auto-hide" },
    ]);
  });

  test("tabs.orientation is gone, and saying so does not cost the rest of the file", () => {
    const { settings, problems } = parseSettings(
      "homepage = 'https://a.b'\n[tabs]\norientation = 'vertical'",
    );

    expect(settings).toEqual({ ...DEFAULT_SETTINGS, homepage: "https://a.b" });
    expect(problems.map(({ field }) => field)).toEqual(["tabs.orientation"]);
  });
});

test("nothing is carried between calls", () => {
  const first: Settings = { ...DEFAULT_SETTINGS, homepage: "https://first.example" };
  parseSettings("homepage = 'unterminated", first);
  // The bad parse above must not have become anyone's previous settings.
  expect(settingsOf("homepage = 'unterminated").homepage).toBe(DEFAULT_SETTINGS.homepage);
});

describe("over a recipe's base", () => {
  const base: Settings = {
    ...DEFAULT_SETTINGS,
    recipe: "modern",
    inputMode: "standard",
    layout: {
      ...DEFAULT_LAYOUT,
      tabs: { ...DEFAULT_LAYOUT.tabs, region: "top", size: "12ch" },
    },
  };

  test("an empty file is the base", () => {
    expect(parseSettings("", DEFAULT_SETTINGS, base).settings).toEqual(base);
  });

  test("a layout table merges field by field: the user's size, the recipe's region", () => {
    const { settings } = parseSettings("[layout.tabs]\nsize = '30ch'", DEFAULT_SETTINGS, base);

    expect(settings.layout.tabs).toEqual({ ...base.layout.tabs, size: "30ch" });
    expect(settings.inputMode).toBe("standard");
    expect(settings.recipe).toBe("modern");
  });

  test("what the user wrote wins over the recipe", () => {
    const { settings } = parseSettings(
      "[input]\nmode = 'vim'\n[layout.tabs]\nregion = 'left'",
      DEFAULT_SETTINGS,
      base,
    );

    expect(settings.inputMode).toBe("vim");
    expect(settings.layout.tabs.region).toBe("left");
  });

  test("a bad value falls back to the recipe, not the defaults", () => {
    const { settings, problems } = parseSettings("[input]\nmode = 'emacs'", DEFAULT_SETTINGS, base);

    expect(settings.inputMode).toBe("standard");
    expect(problems.map(({ field }) => field)).toEqual(["input.mode"]);
  });
});

describe("readRecipeName", () => {
  test("names the recipe, and an empty file is the default one", () => {
    expect(readRecipeName("recipe = 'modern'", "tui")).toEqual({ name: "modern", problems: [] });
    expect(readRecipeName("", "modern")).toEqual({ name: "tui", problems: [] });
    expect(readRecipeName("homepage = 'x'", "modern")).toEqual({ name: "tui", problems: [] });
  });

  test("a broken file keeps the recipe it had, and leaves the reporting to parseSettings", () => {
    expect(readRecipeName("recipe = 'unterminated", "modern")).toEqual({
      name: "modern",
      problems: [],
    });
  });

  test("a name that could not be a file is reported", () => {
    for (const bad of ["'../etc'", "'Modern'", "'-x'", "3"]) {
      const { name, problems } = readRecipeName(`recipe = ${bad}`, "modern");

      expect(name).toBe("tui");
      expect(problems.map(({ field }) => field)).toEqual(["recipe"]);
    }
  });
});
