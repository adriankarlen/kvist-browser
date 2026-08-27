import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { readStyleFiles } from "./user-style-files";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kvist-styles-"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

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
