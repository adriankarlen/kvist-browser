import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { clamp, ZoomStore } from "./zoom";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kvist-zoom-"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

test("an absent file is the empty map", async () => {
  const store = await ZoomStore.load(dir);
  expect(store.get("https://example.com")).toBe(0);
});

test("a malformed file is logged and treated as empty", async () => {
  await writeFile(join(dir, "zoom.json"), "{not valid json", "utf8");

  const store = await ZoomStore.load(dir);

  expect(store.get("https://example.com")).toBe(0);
  expect(console.error).toHaveBeenCalled();
});

test("a valid file is loaded into memory", async () => {
  await writeFile(
    join(dir, "zoom.json"),
    JSON.stringify({ "https://github.com": -1, "https://example.com": 2.5 }),
    "utf8",
  );

  const store = await ZoomStore.load(dir);

  expect(store.get("https://github.com")).toBe(-1);
  expect(store.get("https://example.com")).toBe(2.5);
  expect(store.get("https://other.com")).toBe(0);
});

test("non-numeric entries are ignored", async () => {
  await writeFile(
    join(dir, "zoom.json"),
    JSON.stringify({ "https://a": 1, "https://b": "two", "https://c": null }),
    "utf8",
  );

  const store = await ZoomStore.load(dir);

  expect(store.get("https://a")).toBe(1);
  expect(store.get("https://b")).toBe(0);
  expect(store.get("https://c")).toBe(0);
});

test("set updates the in-memory map synchronously", async () => {
  const store = await ZoomStore.load(dir);
  store.set("https://example.com", 1.5);
  expect(store.get("https://example.com")).toBe(1.5);
});

test("set clamps to Chromium's accepted range", async () => {
  const store = await ZoomStore.load(dir);
  store.set("https://a", 99);
  store.set("https://b", -99);
  expect(store.get("https://a")).toBeCloseTo(5.7, 5);
  expect(store.get("https://b")).toBeCloseTo(-2.8, 5);
});

test("release flushes without waiting for the debounce timer", async () => {
  const store = await ZoomStore.load(dir);
  store.set("https://a", 1);
  // release synchronously triggers a write — the file is on disk once the
  // returned promise settles, with no need to wait out DEBOUNCE_MS.
  store.release();
  await store.flushed();

  const raw = await readFile(join(dir, "zoom.json"), "utf8");
  expect(JSON.parse(raw)).toEqual({ "https://a": 1 });
});

test("release writes the latest set values, not the early ones", async () => {
  const store = await ZoomStore.load(dir);
  store.set("https://a", 1);
  store.set("https://a", 2);
  store.set("https://b", -1);
  store.release();
  await store.flushed();

  const raw = await readFile(join(dir, "zoom.json"), "utf8");
  expect(JSON.parse(raw)).toEqual({ "https://a": 2, "https://b": -1 });
});

test("writes are atomic, so a crash mid-write cannot corrupt the file", async () => {
  const store = await ZoomStore.load(dir);
  store.set("https://a", 1);
  store.release();
  await store.flushed();

  // The temp file used during the write is gone after a successful rename.
  const tmp = join(dir, "zoom.json.tmp");
  await expect(readFile(tmp, "utf8")).rejects.toThrow();
});

test("clamp pins out-of-range values at the nearest edge", () => {
  expect(clamp(0)).toBe(0);
  expect(clamp(-99)).toBeCloseTo(-2.8, 5);
  expect(clamp(99)).toBeCloseTo(5.7, 5);
});
