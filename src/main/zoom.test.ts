import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App } from "electron";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { clamp, flushOnQuit, ZoomStore } from "./zoom";

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

test("an immediate quit after a set lands the write before quitting", async () => {
  const store = await ZoomStore.load(dir);
  const listeners: ((event: { preventDefault(): void }) => void)[] = [];
  let prevented = 0;
  let quits = 0;
  // SAFETY: the fake implements exactly the on("will-quit")/quit surface
  // flushOnQuit uses; quit() re-emits will-quit like the resumed quit does.
  const app = {
    on: (_event: "will-quit", listener: (event: { preventDefault(): void }) => void): void => {
      listeners.push(listener);
    },
    quit: (): void => {
      quits++;
      for (const listener of listeners) listener({ preventDefault: () => void prevented++ });
    },
  } as unknown as Pick<App, "on" | "quit">;
  flushOnQuit(app, store);

  store.set("https://a.example", 1);
  for (const listener of listeners) listener({ preventDefault: () => void prevented++ });

  // The first pass holds the quit until the write has landed.
  expect(prevented).toBe(1);
  expect(quits).toBe(0);

  await store.flushed();
  await new Promise((resolve) => setImmediate(resolve));

  expect(quits).toBe(1);
  // The resumed quit passes through: flushing is already true, so the second
  // will-quit does not hold again.
  expect(prevented).toBe(1);
  const raw = await readFile(join(dir, "zoom.json"), "utf8");
  expect(JSON.parse(raw)).toEqual({ "https://a.example": 1 });
});

test("a write failure is logged, not fatal, and does not poison later flushes", async () => {
  // A file where the directory should be: mkdir, writeFile and rename all fail.
  const blocked = join(dir, "blocked");
  await writeFile(blocked, "x", "utf8");

  const store = await ZoomStore.load(blocked);
  store.set("https://a.example", 1);
  store.release();
  // Before the fix, the mkdir rejection sat outside the try/catch and the
  // fire-and-forget write in release() left it unhandled — and every later
  // flushed() inherited the poisoned promise.
  await expect(store.flushed()).resolves.toBeUndefined();
  expect(console.error).toHaveBeenCalled();
});
