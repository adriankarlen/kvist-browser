import { expect, test } from "vite-plus/test";
import { formatEta, formatRate, percent } from "./progress";

test("percent rounds to whole points and clamps to the total", () => {
  expect(percent(0, 100)).toBe(0);
  expect(percent(42, 100)).toBe(42);
  expect(percent(1, 3)).toBe(33);
  expect(percent(100, 100)).toBe(100);
  // A total that turns out to be a lie must not read as 104%.
  expect(percent(104, 100)).toBe(100);
});

test("an unknown length has no percentage, which is not the same as zero", () => {
  expect(percent(500, 0)).toBeNull();
  expect(percent(500, Number.NaN)).toBeNull();
});

test("rates read like the byte counts beside them", () => {
  expect(formatRate(1024)).toBe("1.0 KB/s");
  expect(formatRate(1536 * 1024)).toBe("1.5 MB/s");
  expect(formatRate(0)).toBe("");
});

test("eta counts down in the largest unit that fits", () => {
  expect(formatEta(0, 1000, 100)).toBe("10s");
  expect(formatEta(0, 25_000, 100)).toBe("4m 10s");
  expect(formatEta(0, 372_000, 100)).toBe("1h 02m");
});

test("an eta below a second is still a second, never zero", () => {
  expect(formatEta(999, 1000, 1000)).toBe("1s");
});

test("there is no eta without a length, a rate, or anything left", () => {
  expect(formatEta(500, 0, 1000)).toBe("");
  expect(formatEta(500, 1000, 0)).toBe("");
  expect(formatEta(1000, 1000, 1000)).toBe("");
});
