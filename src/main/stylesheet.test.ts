import { expect, test, vi } from "vite-plus/test";
import { ReplaceableStylesheet, type StylesheetTarget } from "./stylesheet";

/**
 * The in-memory adapter at the `StylesheetTarget` seam: records what was
 * inserted and removed, and hands out a fresh key per insertion the way
 * Chromium does.
 */
function createTarget(options: { destroyed?: boolean } = {}) {
  const inserted: { css: string; origin: unknown }[] = [];
  const removed: string[] = [];
  let next = 0;

  const target: StylesheetTarget = {
    isDestroyed: () => options.destroyed === true,
    insertCSS: (css: string, insertOptions?: { cssOrigin?: string }) => {
      inserted.push({ css, origin: insertOptions?.cssOrigin });
      return Promise.resolve(`key-${++next}`);
    },
    removeInsertedCSS: (key: string) => {
      removed.push(key);
      return Promise.resolve();
    },
  };

  return { target, inserted, removed };
}

/** Lets the queued swap chain drain; `replace` is fire-and-forget by design. */
const flush = async (): Promise<void> => {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
};

test("the first sheet is inserted with the origin it was built for", async () => {
  const sheet = new ReplaceableStylesheet("author", "kvist: boom:");
  const { target, inserted, removed } = createTarget();

  sheet.replace(target, "body { color: red }");
  await flush();

  expect(inserted).toEqual([{ css: "body { color: red }", origin: "author" }]);
  expect(removed).toEqual([]);
});

test("replacing removes the previous sheet rather than stacking another", async () => {
  const sheet = new ReplaceableStylesheet("user", "kvist: boom:");
  const { target, inserted, removed } = createTarget();

  sheet.replace(target, "a {}");
  await flush();
  sheet.replace(target, "b {}");
  await flush();

  expect(inserted.map(({ css }) => css)).toEqual(["a {}", "b {}"]);
  // The key the first insertion answered with, and only it.
  expect(removed).toEqual(["key-1"]);
});

test("empty CSS removes without inserting", async () => {
  const sheet = new ReplaceableStylesheet("author", "kvist: boom:");
  const { target, inserted, removed } = createTarget();

  sheet.replace(target, "a {}");
  await flush();
  // A page that matches nothing must not be left wearing the last page's CSS.
  sheet.replace(target, "");
  await flush();

  expect(inserted).toHaveLength(1);
  expect(removed).toEqual(["key-1"]);
});

test("a destroyed target is never reached through", async () => {
  const sheet = new ReplaceableStylesheet("author", "kvist: boom:");
  const { target, inserted, removed } = createTarget({ destroyed: true });

  sheet.replace(target, "a {}");
  await flush();

  expect(inserted).toEqual([]);
  expect(removed).toEqual([]);
});

test("overlapping replacements queue rather than race over the current key", async () => {
  const sheet = new ReplaceableStylesheet("author", "kvist: boom:");
  const { target, inserted, removed } = createTarget();

  // Two navigations in flight at once: without serialization the second
  // insertion's key would overwrite the first's before it was removed, and
  // the first sheet would never come off.
  sheet.replace(target, "a {}");
  sheet.replace(target, "b {}");
  sheet.replace(target, "c {}");
  await flush();

  expect(inserted.map(({ css }) => css)).toEqual(["a {}", "b {}", "c {}"]);
  expect(removed).toEqual(["key-1", "key-2"]);
});

test("a failed swap does not wedge the chain", async () => {
  const sheet = new ReplaceableStylesheet("author", "kvist: boom:");
  const { target, inserted } = createTarget();
  const failing = vi.spyOn(target, "insertCSS").mockRejectedValueOnce(new Error("nope"));
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});

  sheet.replace(target, "a {}");
  await flush();
  failing.mockRestore();

  sheet.replace(target, "b {}");
  await flush();

  expect(inserted.map(({ css }) => css)).toEqual(["b {}"]);
  expect(logged).toHaveBeenCalledWith("kvist: boom:", expect.any(Error));
  logged.mockRestore();
});

test("a failed removal is retried by the next queued replacement", async () => {
  const sheet = new ReplaceableStylesheet("author", "kvist: boom:");
  const { target, inserted, removed } = createTarget();
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});

  // Insert a first sheet; this gives us key-1 to track.
  sheet.replace(target, "a {}");
  await flush();

  // Removal of key-1 fails on the second replace.
  const failRemove = vi
    .spyOn(target, "removeInsertedCSS")
    .mockRejectedValueOnce(new Error("transient"));
  sheet.replace(target, "b {}");
  await flush();
  failRemove.mockRestore();

  // Third replace: key-1 must still be in the map and retried now.
  sheet.replace(target, "c {}");
  await flush();

  // key-1 was retried and removed on the third attempt.
  expect(removed).toContain("key-1");
  // b {} never inserted because its swap threw before reaching insertCSS.
  expect(inserted.map(({ css }) => css)).toEqual(["a {}", "c {}"]);
  expect(logged).toHaveBeenCalledWith("kvist: boom:", expect.any(Error));
  logged.mockRestore();
});

test("two targets keep their own sheets", async () => {
  const sheet = new ReplaceableStylesheet("author", "kvist: boom:");
  const first = createTarget();
  const second = createTarget();

  sheet.replace(first.target, "a {}");
  sheet.replace(second.target, "b {}");
  await flush();
  sheet.replace(first.target, "c {}");
  await flush();

  // Replacing one tab's sheet must not touch the other's.
  expect(first.removed).toEqual(["key-1"]);
  expect(second.removed).toEqual([]);
});
