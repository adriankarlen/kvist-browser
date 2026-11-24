import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";
import { isFirstRun, probeFirstRun } from "./first-run";

const tempDir = (): string => mkdtempSync(join(tmpdir(), "kvist-first-run-"));

const probe = (config: string, data: string): Promise<boolean> =>
  Effect.runPromise(probeFirstRun(config, data).pipe(Effect.provide(NodeServices.layer)));

describe("isFirstRun", () => {
  test("only when neither config.toml nor a database exists", () => {
    expect(isFirstRun({ configToml: false, database: false })).toBe(true);
    expect(isFirstRun({ configToml: true, database: false })).toBe(false);
    expect(isFirstRun({ configToml: false, database: true })).toBe(false);
  });
});

describe("probeFirstRun", () => {
  test("a fresh machine is a first run, even with an empty config.css", async () => {
    const config = tempDir();

    writeFileSync(join(config, "config.css"), "");

    expect(await probe(config, join(tempDir(), "missing"))).toBe(true);
  });

  test("an existing database means an upgrade, not a first run", async () => {
    const data = tempDir();

    writeFileSync(join(data, "kvist.sqlite"), "");

    expect(await probe(tempDir(), data)).toBe(false);
  });

  test("the legacy database counts too", async () => {
    const data = tempDir();

    writeFileSync(join(data, "kvist.db"), "");

    expect(await probe(tempDir(), data)).toBe(false);
  });

  test("a config.toml counts", async () => {
    const config = tempDir();

    writeFileSync(join(config, "config.toml"), "");

    expect(await probe(config, tempDir())).toBe(false);
  });

  test("a dangling config.toml symlink counts as a config", async () => {
    const config = tempDir();

    symlinkSync(join(config, "nowhere.toml"), join(config, "config.toml"));

    expect(await probe(config, tempDir())).toBe(false);
  });
});
