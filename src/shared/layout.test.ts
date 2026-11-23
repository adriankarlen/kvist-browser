import { expect, test } from "vite-plus/test";
import { arrange, DEFAULT_LAYOUT, type Layout, tabStripDirection } from "./layout";

const moved = (changes: Partial<Layout>): Layout => ({ ...DEFAULT_LAYOUT, ...changes });

test("the default layout is today's chrome, top to bottom", () => {
  expect(arrange(DEFAULT_LAYOUT)).toEqual({
    top: ["tabs", "omnibox"],
    bottom: ["bookmarks", "downloads", "status", "find"],
    left: [],
    right: [],
    floating: [],
    overlay: ["completion"],
  });
});

test("order sorts a region, and a tie falls back to the default order", () => {
  const layout = moved({
    find: { ...DEFAULT_LAYOUT.find, region: "top", order: 0 },
    omnibox: { ...DEFAULT_LAYOUT.omnibox, order: -1 },
  });

  expect(arrange(layout).top).toEqual(["omnibox", "tabs", "find"]);
});

test("a hidden element is in no region", () => {
  const layout = moved({ tabs: { ...DEFAULT_LAYOUT.tabs, visible: false } });

  expect(Object.values(arrange(layout)).flat()).not.toContain("tabs");
});

test("the tab strip runs along the edge it sits on", () => {
  expect(tabStripDirection("left")).toBe("vertical");
  expect(tabStripDirection("right")).toBe("vertical");
  expect(tabStripDirection("top")).toBe("horizontal");
  expect(tabStripDirection("bottom")).toBe("horizontal");
});
