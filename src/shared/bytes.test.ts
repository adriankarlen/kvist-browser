import { expect, test } from "vite-plus/test";
import { formatBytes } from "./bytes";

test("bytes stay whole", () => {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(1)).toBe("1 B");
  expect(formatBytes(1023)).toBe("1023 B");
});

test("scaled units get one decimal below ten, none above", () => {
  expect(formatBytes(1024)).toBe("1.0 KB");
  expect(formatBytes(1536)).toBe("1.5 KB");
  expect(formatBytes(10 * 1024)).toBe("10 KB");
  expect(formatBytes(1024 ** 2)).toBe("1.0 MB");
  expect(formatBytes(142 * 1024 ** 2)).toBe("142 MB");
});

test("it stops at terabytes rather than running out of units", () => {
  expect(formatBytes(1024 ** 5)).toBe("1024 TB");
});

test("a missing or nonsense count reads as zero, not NaN", () => {
  expect(formatBytes(-1)).toBe("0 B");
  expect(formatBytes(Number.NaN)).toBe("0 B");
});
