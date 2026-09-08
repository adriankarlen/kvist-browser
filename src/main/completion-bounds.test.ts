import { expect, test } from "vite-plus/test";
import type { Rect } from "../shared/ipc";
import { placeCompletion } from "./completion-bounds";

const content = { width: 1000, height: 800 };
const omnibox: Rect = { x: 20, y: 40, width: 960, height: 30 };
const commandLine: Rect = { x: 20, y: 740, width: 960, height: 30 };

test("a list grows out of the bottom edge of the input it belongs to", () => {
  expect(placeCompletion(omnibox, 200, "down", content)).toEqual({
    bounds: { x: 20, y: 70, width: 960, height: 200 },
    inset: { left: 0, top: 0, width: 960 },
  });
});

test("growing up puts the list's bottom edge on the input's top edge", () => {
  expect(placeCompletion(commandLine, 200, "up", content)).toEqual({
    bounds: { x: 20, y: 540, width: 960, height: 200 },
    inset: { left: 0, top: 0, width: 960 },
  });
});

/**
 * The reason the inset exists. A view is placed in whole pixels; the omnibox
 * is not, because the chrome measures its padding in `ch`. What matters is
 * that the two add back up to exactly where the input is.
 */
test("a fractional anchor keeps its exact edges once the inset is added back", () => {
  const fractional: Rect = { x: 234.396, y: 18.5, width: 1021.604, height: 26.5 };
  const { bounds, inset } = placeCompletion(fractional, 79, "down", { width: 1264, height: 1420 });

  expect(bounds.x + inset.left).toBeCloseTo(fractional.x, 10);
  expect(bounds.x + inset.left + inset.width).toBeCloseTo(fractional.x + fractional.width, 10);
  expect(bounds.y + inset.top).toBeCloseTo(fractional.y + fractional.height, 10);
});

test("the view is whole pixels, and never smaller than the list inside it", () => {
  const fractional: Rect = { x: 234.396, y: 18.5, width: 1021.604, height: 26.5 };
  const { bounds, inset } = placeCompletion(fractional, 79, "down", { width: 1264, height: 1420 });

  expect(Number.isInteger(bounds.x)).toBe(true);
  expect(Number.isInteger(bounds.y)).toBe(true);
  expect(Number.isInteger(bounds.width)).toBe(true);
  expect(Number.isInteger(bounds.height)).toBe(true);
  expect(bounds.width).toBeGreaterThanOrEqual(inset.left + inset.width);
  expect(bounds.height).toBeGreaterThanOrEqual(inset.top + 79);
});

test("a fractional anchor growing up lands its bottom edge on the input's top", () => {
  const fractional: Rect = { x: 20.25, y: 740.75, width: 960.5, height: 30 };
  const { bounds, inset } = placeCompletion(fractional, 79.4, "up", content);

  expect(bounds.y + inset.top + 79.4).toBeCloseTo(fractional.y, 10);
  expect(bounds.x + inset.left).toBeCloseTo(fractional.x, 10);
});

test("a list taller than the space below it is cut to fit rather than flipped", () => {
  const { bounds } = placeCompletion(omnibox, 5000, "down", content);

  expect(bounds.y).toBe(70);
  expect(bounds.height).toBe(730);
});

test("a list taller than the space above it stops at the top of the window", () => {
  const { bounds } = placeCompletion(commandLine, 5000, "up", content);

  expect(bounds.y).toBe(0);
  expect(bounds.height).toBe(740);
});

test("an unmeasured list is offered every pixel the direction has room for", () => {
  const { bounds } = placeCompletion(omnibox, Number.POSITIVE_INFINITY, "down", content);

  expect(bounds).toEqual({ x: 20, y: 70, width: 960, height: 730 });
});

test("an input flush against the edge it grows into gets no room at all", () => {
  const flush: Rect = { x: 0, y: 770, width: 100, height: 30 };

  expect(placeCompletion(flush, 200, "down", content).bounds.height).toBe(0);
});

test("an anchor wider than the window is trimmed to it", () => {
  const wide: Rect = { x: 0, y: 40, width: 4000, height: 30 };
  const { bounds } = placeCompletion(wide, 100, "down", content);

  expect(bounds.width).toBe(1000);
  expect(bounds.x).toBe(0);
});

test("a list that would run off the right edge slides back inside it", () => {
  const offset: Rect = { x: 900, y: 40, width: 300, height: 30 };
  const { bounds } = placeCompletion(offset, 100, "down", content);

  expect(bounds.x + bounds.width).toBe(1000);
});

test("an empty list takes no space", () => {
  expect(placeCompletion(omnibox, 0, "down", content).bounds.height).toBe(0);
});
