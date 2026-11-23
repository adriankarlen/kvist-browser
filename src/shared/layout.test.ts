import { expect, test } from "vite-plus/test";
import {
  arrange,
  completionGrow,
  DEFAULT_LAYOUT,
  isPalette,
  elementDirection,
  type Layout,
  SUPPORT,
} from "./layout";

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

test("a hidden element keeps its place, so it can still show when summoned", () => {
  const layout = moved({ find: { ...DEFAULT_LAYOUT.find, visible: false } });

  expect(arrange(layout).bottom).toContain("find");
});

test("an element runs along the edge it sits on", () => {
  expect(elementDirection("left")).toBe("vertical");
  expect(elementDirection("right")).toBe("vertical");
  expect(elementDirection("top")).toBe("horizontal");
  expect(elementDirection("bottom")).toBe("horizontal");
});

test("a completion list opens away from the edge its input sits on", () => {
  const anchor = { y: 0, height: 20 };

  expect(completionGrow("top", { y: 900, height: 20 }, 1000)).toBe("down");
  expect(completionGrow("bottom", anchor, 1000)).toBe("up");
});

test("at the side, a completion list opens towards the larger half of the window", () => {
  expect(completionGrow("left", { y: 100, height: 20 }, 1000)).toBe("down");
  expect(completionGrow("right", { y: 800, height: 20 }, 1000)).toBe("up");
});

test("the omnibox goes on top or floats, and the others go to any edge", () => {
  for (const id of ["tabs", "bookmarks", "downloads", "status", "find"] as const) {
    expect(SUPPORT[id].regions).toEqual(["top", "bottom", "left", "right"]);
  }

  expect(SUPPORT.omnibox.regions).toEqual(["top", "floating"]);
  expect(SUPPORT.completion.regions).toEqual(["overlay"]);
});

test("only the tab strip can auto-hide", () => {
  const autohiding = Object.entries(SUPPORT).filter(([, support]) => support.autohide);

  expect(autohiding.map(([id]) => id)).toEqual(["tabs"]);
});

test("only a floating omnibox is the palette", () => {
  expect(isPalette(DEFAULT_LAYOUT)).toBe(false);
  expect(
    isPalette({ ...DEFAULT_LAYOUT, omnibox: { ...DEFAULT_LAYOUT.omnibox, region: "floating" } }),
  ).toBe(true);
});
