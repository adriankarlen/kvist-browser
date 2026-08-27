import type { watch } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { UserStyleSource } from "./user-styles";
import { readStyleFiles, watchStyleFiles } from "./user-style-files";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kvist-styles-"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

/** Polls until `condition` is true or the deadline passes, for the debounced watcher. */
async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition never became true");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("a missing directory is created rather than treated as an error", async () => {
  const fresh = join(dir, "nested", "styles");
  const sources = await readStyleFiles(fresh);
  expect(sources).toEqual([]);
  expect(console.error).not.toHaveBeenCalled();
});

test("only .css files are read", async () => {
  await writeFile(join(dir, "a.css"), "body {}", "utf8");
  await writeFile(join(dir, "notes.txt"), "not css", "utf8");
  await writeFile(join(dir, "a.css.swp"), "swap file", "utf8");
  await writeFile(join(dir, "a.css~"), "backup file", "utf8");

  const sources = await readStyleFiles(dir);

  expect(sources).toEqual([{ id: join(dir, "a.css"), source: "body {}" }]);
});

test("dotfiles are ignored even when named *.css", async () => {
  await writeFile(join(dir, ".hidden.css"), "body {}", "utf8");
  await writeFile(join(dir, "shown.css"), "html {}", "utf8");

  const sources = await readStyleFiles(dir);

  expect(sources).toEqual([{ id: join(dir, "shown.css"), source: "html {}" }]);
});

test("a subdirectory named *.css is not read as a file", async () => {
  await mkdir(join(dir, "trap.css"));
  await writeFile(join(dir, "real.css"), "html {}", "utf8");

  const sources = await readStyleFiles(dir);

  expect(sources).toEqual([{ id: join(dir, "real.css"), source: "html {}" }]);
});

test("a symlinked style file is read like any other", async () => {
  const target = join(dir, "actual.css");
  await writeFile(target, "body { color: red }", "utf8");
  await symlink(target, join(dir, "linked.css"));

  const sources = await readStyleFiles(dir);

  expect(sources.map((s) => s.id).sort()).toEqual([
    join(dir, "actual.css"),
    join(dir, "linked.css"),
  ]);
});

test("files are sorted by name for a stable order", async () => {
  await writeFile(join(dir, "z.css"), "z", "utf8");
  await writeFile(join(dir, "a.css"), "a", "utf8");
  await writeFile(join(dir, "m.css"), "m", "utf8");

  const sources = await readStyleFiles(dir);

  expect(sources.map((s) => s.id)).toEqual([
    join(dir, "a.css"),
    join(dir, "m.css"),
    join(dir, "z.css"),
  ]);
});

test("an empty directory yields no sources", async () => {
  const sources = await readStyleFiles(dir);
  expect(sources).toEqual([]);
});

test("a directory that cannot be created is logged, not thrown", async () => {
  // A plain file sits where a directory segment needs to be — mkdir(...,
  // { recursive: true }) rejects (ENOTDIR) rather than creating anything.
  const blocker = join(dir, "blocker");
  await writeFile(blocker, "not a directory", "utf8");

  const sources = await readStyleFiles(join(blocker, "styles"));

  expect(sources).toEqual([]);
  expect(console.error).toHaveBeenCalled();
});

test("a change to the directory triggers a rescan after the debounce", async () => {
  const onChange = vi.fn<(sources: UserStyleSource[]) => void>();
  const release = await watchStyleFiles(onChange, dir);

  await writeFile(join(dir, "a.css"), "body {}", "utf8");
  await waitFor(() => onChange.mock.calls.length > 0);

  expect(onChange).toHaveBeenCalledWith([{ id: join(dir, "a.css"), source: "body {}" }]);
  release();
});

test("several rapid changes coalesce into one rescan", async () => {
  const onChange = vi.fn<(sources: UserStyleSource[]) => void>();
  const release = await watchStyleFiles(onChange, dir);

  await writeFile(join(dir, "a.css"), "a", "utf8");
  await writeFile(join(dir, "b.css"), "b", "utf8");
  await writeFile(join(dir, "c.css"), "c", "utf8");
  await waitFor(() => onChange.mock.calls.length > 0);
  // Give any second, wrongly-uncoalesced rescan a chance to land too.
  await sleep(100);

  expect(onChange).toHaveBeenCalledTimes(1);
  release();
});

test("release before the debounce fires cancels the rescan outright", async () => {
  const onChange = vi.fn<(sources: UserStyleSource[]) => void>();
  const release = await watchStyleFiles(onChange, dir);

  await writeFile(join(dir, "a.css"), "a", "utf8");
  release();
  await sleep(150);

  expect(onChange).not.toHaveBeenCalled();
});

test("release during an in-flight rescan drops its result", async () => {
  const onChange = vi.fn<(sources: UserStyleSource[]) => void>();
  let resolveRead: ((sources: UserStyleSource[]) => void) | undefined;
  const read = vi.fn(
    () =>
      new Promise<UserStyleSource[]>((resolve) => {
        resolveRead = resolve;
      }),
  );

  const release = await watchStyleFiles(onChange, dir, read);
  await writeFile(join(dir, "a.css"), "a", "utf8");
  await waitFor(() => read.mock.calls.length > 0);

  // The rescan has started but not resolved — release lands in the gap.
  release();
  resolveRead?.([{ id: "a.css", source: "a" }]);
  await sleep(10);

  expect(onChange).not.toHaveBeenCalled();
});

test("a directory that cannot be created yields a no-op release", async () => {
  const blocker = join(dir, "blocker");
  await writeFile(blocker, "not a directory", "utf8");
  const onChange = vi.fn<(sources: UserStyleSource[]) => void>();

  const release = await watchStyleFiles(onChange, join(blocker, "styles"));

  expect(console.error).toHaveBeenCalled();
  // Nothing to release, but calling it must not throw.
  expect(() => release()).not.toThrow();
});

test("a slow rescan cannot overwrite a result from one started after it", async () => {
  const onChange = vi.fn<(sources: UserStyleSource[]) => void>();
  const resolvers: ((sources: UserStyleSource[]) => void)[] = [];
  const read = vi.fn(
    () =>
      new Promise<UserStyleSource[]>((resolve) => {
        resolvers.push(resolve);
      }),
  );

  const release = await watchStyleFiles(onChange, dir, read);

  // The first change starts a rescan that will stay pending until resolved
  // by hand below.
  await writeFile(join(dir, "a.css"), "a", "utf8");
  await waitFor(() => read.mock.calls.length === 1);

  // Once the debounce has fully elapsed, a second change starts a second
  // rescan while the first is still in flight.
  await sleep(60);
  await writeFile(join(dir, "b.css"), "b", "utf8");
  await waitFor(() => read.mock.calls.length === 2);

  // The newer rescan resolves first — realistic when the first one is doing
  // more work — then the older, slower one finally resolves too.
  resolvers[1]?.([{ id: "b.css", source: "b" }]);
  await sleep(10);
  resolvers[0]?.([{ id: "a.css", source: "a" }]);
  await sleep(10);

  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith([{ id: "b.css", source: "b" }]);

  release();
});

test("a watch that cannot be acquired yields a no-op release rather than throwing", async () => {
  const onChange = vi.fn<(sources: UserStyleSource[]) => void>();
  const watchDir = vi.fn(() => {
    throw new Error("EMFILE: too many open files");
  });

  const release = await watchStyleFiles(
    onChange,
    dir,
    undefined,
    // SAFETY: the stub only needs to be callable and throw; watchStyleFiles
    // never reads any other property off it.
    watchDir as unknown as typeof watch,
  );

  expect(console.error).toHaveBeenCalled();
  expect(() => release()).not.toThrow();
});
