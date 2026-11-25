import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Queue, Stream } from "effect";
import type { Scope } from "effect";
import { DEFAULT_CONFIG } from "../../shared/config";
import { describeProblem } from "../features/config/config.program";
import { BASE_SETTINGS } from "../settings";
import { ConfigFiles, type LoadedConfig } from "./config-files";

interface Files {
  write: (file: string, text: string) => Effect.Effect<void>;
  read: (file: string) => Effect.Effect<string>;
  dir: string;
}

type Needs = ConfigFiles | Scope.Scope | FileSystem.FileSystem | Path.Path;

const withDir = <A, E>(body: (files: Files) => Effect.Effect<A, E, Needs>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped();

    const files: Files = {
      write: (file, text) =>
        fs
          .makeDirectory(path.dirname(path.join(dir, file)), { recursive: true })
          .pipe(Effect.andThen(fs.writeFileString(path.join(dir, file), text)), Effect.orDie),
      read: (file) => fs.readFileString(path.join(dir, file)).pipe(Effect.orDie),
      dir,
    };

    return yield* body(files).pipe(Effect.provide(ConfigFiles.layerAt(dir)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

/** Collects the config stream into a queue so a test can take one load at a time. */
const subscribe = Effect.gen(function* () {
  const { changes } = yield* ConfigFiles;
  const queue = yield* Queue.unbounded<LoadedConfig>();

  yield* changes.pipe(
    Stream.runForEach((loaded) => Queue.offer(queue, loaded)),
    Effect.forkScoped,
  );

  return queue;
});

describe("ConfigFiles", () => {
  it.live("emits the current config first, with missing files as defaults", () =>
    withDir(() =>
      Effect.gen(function* () {
        const loads = yield* subscribe;
        const first = yield* Queue.take(loads);

        expect(first).toEqual({
          config: { ...DEFAULT_CONFIG, settings: BASE_SETTINGS },
          problems: [],
          recipes: ["tui"],
        });
      }),
    ),
  );

  it.live("emits again after a save, and a syntax error keeps the last good settings", () =>
    withDir(({ write }) =>
      Effect.gen(function* () {
        const loads = yield* subscribe;

        yield* Queue.take(loads);
        yield* Effect.sleep("20 millis");
        yield* write("config.toml", 'homepage = "https://kept.example"');

        const saved = yield* Queue.take(loads);

        expect(saved.config.settings.homepage).toBe("https://kept.example");

        yield* write("config.toml", "homepage = ");
        const broken = yield* Queue.take(loads);

        expect(broken.config.settings.homepage).toBe("https://kept.example");
        expect(broken.problems.map(describeProblem)[0]).toMatch(/^config\.toml: .*line 1, column/);
      }),
    ),
  );

  it.live("ignores files other than config.css and config.toml", () =>
    withDir(({ write }) =>
      Effect.gen(function* () {
        const loads = yield* subscribe;

        yield* Queue.take(loads);
        yield* write("notes.txt", "hello");
        yield* Effect.sleep("150 millis");
        expect(yield* Queue.size(loads)).toBe(0);
      }),
    ),
  );

  it.live("a user recipe's CSS and defaults load under config.toml", () =>
    withDir(({ write }) =>
      Effect.gen(function* () {
        yield* write("recipes/test.css", ":root { --kv-density: 2; }");
        yield* write("recipes/test.toml", "format = 1\n[input]\nmode = 'standard'");
        yield* write("config.toml", "recipe = 'test'\n[layout.tabs]\nsize = '20ch'");

        const loads = yield* subscribe;
        const { config, problems, recipes } = yield* Queue.take(loads);

        expect(problems).toEqual([]);
        expect(recipes).toEqual(["test", "tui"]);
        expect(config.recipe).toEqual({ name: "test", css: ":root { --kv-density: 2; }" });
        expect(config.settings.recipe).toBe("test");
        expect(config.settings.inputMode).toBe("standard");
        expect(config.settings.layout.tabs.size).toBe("20ch");
      }),
    ),
  );

  it.live("a user keymap in keymaps/ is the preset [input] mode names", () =>
    withDir(({ write }) =>
      Effect.gen(function* () {
        yield* write(
          "keymaps/mine.toml",
          'format = 1\nbase = "vim"\n[keys.normal]\n"J" = "tab.next"',
        );
        yield* write("config.toml", "[input]\nmode = 'mine'");

        const loads = yield* subscribe;
        const { config, problems } = yield* Queue.take(loads);
        const bound = config.settings.keymap.bindings.find(({ notation }) => notation === "J");

        expect(problems).toEqual([]);
        expect(config.settings.keymap.name).toBe("mine");
        expect(bound?.command).toBe("tab.next");
      }),
    ),
  );

  it.live("editing a keymap reloads, and its problems name its file", () =>
    withDir(({ write }) =>
      Effect.gen(function* () {
        yield* write("config.toml", "[input]\nmode = 'mine'");
        yield* write("keymaps/mine.toml", "format = 1");

        const loads = yield* subscribe;

        yield* Queue.take(loads);
        yield* Effect.sleep("20 millis");
        yield* write("keymaps/mine.toml", 'format = 1\n[keys.normal]\n"q" = "nope"');

        const edited = yield* Queue.take(loads);

        expect(edited.problems.map(describeProblem)).toEqual([
          'keymaps/mine.toml: keys.normal."q": no command "nope"',
        ]);
      }),
    ),
  );

  it.live("editing the active recipe reloads, and its problems name its file", () =>
    withDir(({ write }) =>
      Effect.gen(function* () {
        yield* write("recipes/test.css", "");
        yield* write("config.toml", "recipe = 'test'");

        const loads = yield* subscribe;

        yield* Queue.take(loads);
        yield* Effect.sleep("20 millis");
        yield* write("recipes/test.toml", "[input]\nmode = 'standard'");

        const edited = yield* Queue.take(loads);

        expect(edited.problems.map(describeProblem)).toEqual([
          "recipes/test.toml: no format; add format = 1",
        ]);
      }),
    ),
  );

  it.live("an unknown recipe falls back to tui and says so", () =>
    withDir(({ write }) =>
      Effect.gen(function* () {
        yield* write("config.toml", "recipe = 'nope'");

        const { config, problems } = yield* Queue.take(yield* subscribe);

        expect(config.recipe.name).toBe("tui");
        expect(problems.map(describeProblem)).toEqual([
          'config.toml: recipe: no recipe named "nope"; available: "tui"',
        ]);
      }),
    ),
  );

  it.live("setRecipe edits config.toml in place, and the watcher applies it", () =>
    withDir(({ write, read }) =>
      Effect.gen(function* () {
        yield* write("recipes/test.css", "a {}");
        yield* write("config.toml", "# mine\nadblock = false\n");

        const loads = yield* subscribe;

        yield* Queue.take(loads);
        yield* Effect.sleep("20 millis");
        yield* Effect.flatMap(Effect.service(ConfigFiles), ({ setRecipe }) => setRecipe("test"));

        expect(yield* read("config.toml")).toBe('recipe = "test"\n# mine\nadblock = false\n');
        expect((yield* Queue.take(loads)).config.recipe.name).toBe("test");
      }),
    ),
  );

  it.live("setRecipe keeps a symlinked config.toml a symlink, and still applies it", () =>
    withDir(({ write, dir }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const outside = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie);
        const target = path.join(outside, "dotfiles.toml");

        yield* write("recipes/test.css", "");
        yield* fs.writeFileString(target, "adblock = false\n").pipe(Effect.orDie);
        yield* fs.symlink(target, path.join(dir, "config.toml")).pipe(Effect.orDie);

        const loads = yield* subscribe;

        yield* Queue.take(loads);
        // macOS reports writes made just before a watch starts; let those pass first.
        yield* Effect.sleep("300 millis");
        yield* Queue.clear(loads);
        yield* Effect.flatMap(Effect.service(ConfigFiles), ({ setRecipe }) => setRecipe("test"));

        // The directory watch cannot see a write at a target outside it.
        const applied = yield* Queue.take(loads).pipe(Effect.timeout("1 second"));

        expect(applied.config.recipe.name).toBe("test");
        expect(yield* fs.readLink(path.join(dir, "config.toml")).pipe(Effect.orDie)).toBe(target);
        expect(yield* fs.readFileString(target).pipe(Effect.orDie)).toBe(
          'recipe = "test"\nadblock = false\n',
        );
      }),
    ),
  );

  it.live("setRecipe refuses a config.toml that does not parse, and leaves it alone", () =>
    withDir(({ write, read }) =>
      Effect.gen(function* () {
        yield* write("config.toml", "homepage = ");

        const error = yield* Effect.flip(
          Effect.flatMap(Effect.service(ConfigFiles), ({ setRecipe }) => setRecipe("tui")),
        );

        expect(error.reason).toBe("config.toml has an error; fix it first");
        expect(yield* read("config.toml")).toBe("homepage = ");
      }),
    ),
  );

  it.live("config.toml still reloads when recipes/ cannot be made", () =>
    withDir(({ write }) =>
      Effect.gen(function* () {
        yield* write("recipes", "a file where the directory should be");

        const loads = yield* subscribe;

        yield* Queue.take(loads);
        yield* Effect.sleep("20 millis");
        yield* write("config.toml", "adblock = false");

        const saved = yield* Queue.take(loads).pipe(Effect.timeout("1 second"));

        expect(saved.config.settings.adblock).toBe(false);
      }),
    ),
  );

  it.live("a syntax error does not keep settings from a recipe that is gone", () =>
    withDir(({ write, dir }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        yield* write("recipes/test.css", "");
        yield* write("recipes/test.toml", "format = 1\n[input]\nmode = 'standard'");
        yield* write("config.toml", "recipe = 'test'");

        const loads = yield* subscribe;

        expect((yield* Queue.take(loads)).config.settings.inputMode).toBe("standard");
        yield* Effect.sleep("20 millis");
        yield* fs.remove(path.join(dir, "recipes/test.css")).pipe(Effect.orDie);
        yield* write("config.toml", "recipe = ");

        const broken = yield* Queue.take(loads);

        expect(broken.config.recipe.name).toBe("tui");
        expect(broken.config.settings.recipe).toBe("tui");
        expect(broken.config.settings.inputMode).toBe("vim");
      }),
    ),
  );

  it.live("a failed save leaves config.toml and its symlink as they were", () =>
    withDir(({ dir }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const outside = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie);
        const target = path.join(outside, "dotfiles.toml");
        const link = path.join(dir, "config.toml");

        yield* fs.writeFileString(target, "adblock = false\n").pipe(Effect.orDie);
        yield* fs.symlink(target, link).pipe(Effect.orDie);
        // No new file can be made beside the target, so the save fails before touching it.
        yield* fs.chmod(outside, 0o555).pipe(Effect.orDie);

        const error = yield* Effect.flip(
          Effect.flatMap(Effect.service(ConfigFiles), ({ setRecipe }) => setRecipe("tui")),
        ).pipe(Effect.ensuring(Effect.orDie(fs.chmod(outside, 0o755))));

        expect(error.reason).toMatch(/^could not write config\.toml/);
        expect(yield* fs.readLink(link).pipe(Effect.orDie)).toBe(target);
        expect(yield* fs.readFileString(target).pipe(Effect.orDie)).toBe("adblock = false\n");
        expect(yield* fs.readDirectory(outside).pipe(Effect.orDie)).toEqual(["dotfiles.toml"]);
      }),
    ),
  );

  it.live("preview loads in-memory text over the recipe, and writes nothing", () =>
    withDir(({ write, dir }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        yield* write("recipes/test.css", ":root { --kv-color-bg: red; }");
        yield* write("recipes/test.toml", "format = 1\n[layout.tabs]\nregion = 'left'");

        const { preview } = yield* ConfigFiles;
        const loaded = yield* preview({ toml: 'recipe = "test"', css: ":root{}" });

        expect(loaded.config.recipe).toEqual({
          name: "test",
          css: ":root { --kv-color-bg: red; }",
        });
        expect(loaded.config.settings.layout.tabs.region).toBe("left");
        expect(loaded.config.css).toBe(":root{}");
        expect(loaded.problems).toEqual([]);
        const written = yield* fs.readDirectory(dir).pipe(Effect.orDie);

        expect([...written].sort()).toEqual(["keymaps", "recipes"]);
      }),
    ),
  );

  it.live("preview without CSS keeps the config.css on disk", () =>
    withDir(({ write }) =>
      Effect.gen(function* () {
        yield* write("config.css", "/* mine */");

        const { preview } = yield* ConfigFiles;
        const loaded = yield* preview({ toml: 'recipe = "tui"', css: undefined });

        expect(loaded.config.css).toBe("/* mine */");
      }),
    ),
  );

  it.live("recipeOptions lists every recipe with its name and defaults", () =>
    withDir(({ write }) =>
      Effect.gen(function* () {
        yield* write("recipes/test.css", "");
        yield* write(
          "recipes/test.toml",
          "format = 1\nname = 'Test'\ndescription = 'd'\n[input]\nmode = 'standard'",
        );

        const options = yield* Effect.flatMap(Effect.service(ConfigFiles), (f) => f.recipeOptions);

        expect(options).toEqual([
          {
            id: "test",
            name: "Test",
            description: "d",
            inputMode: "standard",
            omnibox: "top",
            tabs: "top",
          },
          {
            id: "tui",
            name: "TUI",
            description: "TUI look: monospace, framed panels, vim keys.",
            inputMode: "vim",
            omnibox: "top",
            tabs: "top",
          },
        ]);
      }),
    ),
  );

  it.live("a recipe naming a user keymap offers that keymap's engine", () =>
    withDir(({ write }) =>
      Effect.gen(function* () {
        yield* write("keymaps/mine.toml", 'format = 1\nbase = "standard"');
        yield* write("recipes/test.css", "");
        yield* write("recipes/test.toml", "format = 1\n[input]\nmode = 'mine'");

        const options = yield* Effect.flatMap(Effect.service(ConfigFiles), (f) => f.recipeOptions);

        expect(options.find(({ id }) => id === "test")?.inputMode).toBe("standard");
      }),
    ),
  );

  it.live("writeFirstRun creates both files, and the watcher picks them up", () =>
    withDir(({ read }) =>
      Effect.gen(function* () {
        const loads = yield* subscribe;
        const files = yield* ConfigFiles;

        yield* Queue.take(loads);
        expect(yield* files.cssExists).toBe(false);
        yield* files.writeFirstRun({ toml: "adblock = false\n", css: ":root {}\n" });

        const saved = yield* Queue.take(loads).pipe(Effect.timeout("1 second"));

        expect(saved.config.settings.adblock).toBe(false);
        expect(yield* read("config.toml")).toBe("adblock = false\n");
        expect(yield* read("config.css")).toBe(":root {}\n");
        expect(yield* files.cssExists).toBe(true);
      }),
    ),
  );

  it.live("writeFirstRun never replaces a config.toml that appeared meanwhile", () =>
    withDir(({ write, read }) =>
      Effect.gen(function* () {
        yield* write("config.toml", "# mine\n");

        const error = yield* Effect.flip(
          Effect.flatMap(Effect.service(ConfigFiles), (f) =>
            f.writeFirstRun({ toml: "adblock = false\n", css: ":root {}\n" }),
          ),
        );

        expect(error.reason).toBe("config.toml already exists; it was left as it is");
        expect(yield* read("config.toml")).toBe("# mine\n");
      }),
    ),
  );

  it.live("writeFirstRun never replaces config.css", () =>
    withDir(({ write, read }) =>
      Effect.gen(function* () {
        yield* write("config.css", "/* mine */");
        yield* Effect.flatMap(Effect.service(ConfigFiles), (f) =>
          f.writeFirstRun({ toml: "adblock = false\n", css: ":root {}\n" }),
        );

        expect(yield* read("config.css")).toBe("/* mine */");
        expect(yield* read("config.toml")).toBe("adblock = false\n");
      }),
    ),
  );

  it.live("a config.toml that appeared meanwhile also takes back the CSS this save made", () =>
    withDir(({ write, dir }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        yield* write("config.toml", "# mine\n");

        const error = yield* Effect.flip(
          Effect.flatMap(Effect.service(ConfigFiles), (f) =>
            f.writeFirstRun({ toml: "adblock = false\n", css: ":root {}\n" }),
          ),
        );

        expect(error.exists).toBe(true);
        expect(yield* fs.exists(path.join(dir, "config.css")).pipe(Effect.orDie)).toBe(false);
      }),
    ),
  );

  it.live("a failed CSS write saves nothing, so a retry still works", () =>
    withDir(({ dir, read }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const files = yield* ConfigFiles;
        const save = files.writeFirstRun({ toml: "adblock = false\n", css: ":root {}\n" });

        // A read-only directory refuses the new file without it existing already.
        yield* fs.chmod(dir, 0o555).pipe(Effect.orDie);

        const error = yield* Effect.flip(save).pipe(
          Effect.ensuring(Effect.orDie(fs.chmod(dir, 0o755))),
        );

        expect(error).toMatchObject({ exists: false });
        expect(error.reason).toMatch(/^could not write config\.css/);
        expect(yield* fs.readDirectory(dir).pipe(Effect.orDie)).toEqual([]);

        yield* save;
        expect(yield* read("config.toml")).toBe("adblock = false\n");
      }),
    ),
  );
});
