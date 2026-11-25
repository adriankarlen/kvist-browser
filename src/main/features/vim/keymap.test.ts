import { Schema } from "effect";
import { Toml } from "effect/encoding";
import { Result } from "effect";
import { describe, expect, test } from "vite-plus/test";
import { Binding } from "../../../shared/schema/keymap";
import { buildKeymap, type KeyLayer } from "./keymap";

/** A `[keys]` layer from TOML text, as config.toml or a preset file would hold it. */
function layer(toml: string, file?: string): KeyLayer {
  const parsed = Toml.parse(toml);

  if (Result.isFailure(parsed)) throw new Error(parsed.failure.message);

  return file === undefined ? { keys: parsed.success.keys } : { keys: parsed.success.keys, file };
}

const build = (
  toml: string,
  engine: "vim" | "standard" = "vim",
  platform: NodeJS.Platform = "linux",
) => buildKeymap(engine, [layer(toml)], platform);

/** Each binding as `table notation command[ arg]`. */
const lines = (built: ReturnType<typeof buildKeymap>): string[] =>
  built.bindings.map(
    ({ table, notation, command, arg }) =>
      `${table} ${notation} ${command}${arg === undefined ? "" : ` ${arg}`}`,
  );

const problems = (built: ReturnType<typeof buildKeymap>): string[] =>
  built.problems.map(({ file, field, reason }) => `${file ? `${file}: ` : ""}${field}: ${reason}`);

describe("defaults", () => {
  test("the vim preset is modal and has no chords", () => {
    const built = buildKeymap("vim", [], "linux");

    expect(lines(built)).toContain("normal gt tab.next");
    expect(built.bindings.some(({ table }) => table === "chords")).toBe(false);
    expect(built.problems).toEqual([]);
  });

  test("the standard preset is chords only", () => {
    const built = buildKeymap("standard", [], "darwin");

    expect(lines(built)).toContain("chords Mod+1 tab.select 1");
    expect(built.bindings.every(({ table }) => table === "chords")).toBe(true);
    expect(built.problems).toEqual([]);
  });

  test("every binding crosses the wire, including those with no argument or mode", () => {
    const encode = Schema.encodeUnknownSync(Schema.Array(Binding));

    expect(() => encode(buildKeymap("vim", [], "linux").bindings)).not.toThrow();
    expect(() => encode(buildKeymap("standard", [], "linux").bindings)).not.toThrow();
  });
});

describe("layering", () => {
  test("a key is added, replaced, or unbound with an empty string", () => {
    const built = build(`
      [keys.normal]
      "J" = "tab.next"
      "t" = "tab.close"
      "x" = ""
    `);

    expect(lines(built)).toContain("normal J tab.next");
    expect(lines(built)).toContain("normal t tab.close");
    expect(lines(built)).not.toContain("normal t tab.new");
    expect(lines(built).some((line) => line.startsWith("normal x "))).toBe(false);
    expect(built.problems).toEqual([]);
  });

  test("config.toml goes over the preset file, which goes over the defaults", () => {
    const built = buildKeymap(
      "vim",
      [
        layer('[keys.normal]\n"J" = "tab.next"\n"K" = "tab.prev"', "keymaps/mine.toml"),
        layer('[keys.normal]\n"K" = "nav.back"'),
      ],
      "linux",
    );

    expect(lines(built)).toContain("normal J tab.next");
    expect(lines(built)).toContain("normal K nav.back");
    expect(lines(built)).not.toContain("normal K tab.prev");
  });

  test("a later layer replaces the same key however it is spelled, without a warning", () => {
    const built = build('[keys.chords]\n"Ctrl+T" = "tab.close"', "standard");

    expect(lines(built)).toContain("chords Ctrl+T tab.close");
    expect(lines(built)).not.toContain("chords Mod+T tab.new");
    expect(built.problems).toEqual([]);
  });

  test("a command line may use an alias and pass an argument", () => {
    const built = build('[keys.normal]\n"Q" = "quit"\n"<C-1>" = "tab.select 1"');

    expect(lines(built)).toContain("normal Q tab.close");
    expect(lines(built)).toContain("normal <C-1> tab.select 1");
  });

  test("a binding takes the mode its command enters", () => {
    const { bindings } = build('[keys.normal]\n"O" = "focus.omnibox"');

    expect(bindings.find(({ notation }) => notation === "O")?.enter).toBe("insert");
  });

  test("a vim preset may add chords, which work in every mode", () => {
    expect(lines(build('[keys.chords]\n"Ctrl+Tab" = "tab.next"'))).toContain(
      "chords Ctrl+Tab tab.next",
    );
  });

  test("a standard preset ignores modal tables, and does not nag about them", () => {
    const built = build('[keys.normal]\n"J" = "tab.next"', "standard");

    expect(built.bindings.every(({ table }) => table === "chords")).toBe(true);
    expect(built.problems).toEqual([]);
  });
});

describe("problems", () => {
  test("an unknown or engine-only command, or a value that is not a command line", () => {
    const built = build(`
      [keys.normal]
      "q" = "tab.qiut"
      "w" = "hints.key"
      "e" = 3
    `);

    expect(problems(built)).toEqual([
      'keys.normal."q": no command "tab.qiut"',
      'keys.normal."w": "hints.key" cannot be bound to a key',
      'keys.normal."e": not a command line',
    ]);
    expect(lines(built).some((line) => /^normal [qwe] /.test(line))).toBe(false);
  });

  test("notation that is not a key", () => {
    expect(problems(build('[keys.normal]\n"<C-" = "tab.new"'))).toEqual([
      'keys.normal."<C-": not a key',
    ]);
    expect(problems(build('[keys.chords]\n"Hyper+T" = "tab.new"'))).toEqual([
      'keys.chords."Hyper+T": not a key',
    ]);
  });

  test("a key that hides longer ones, named on whichever side the user wrote", () => {
    expect(problems(build('[keys.normal]\n"g" = "tab.new"'))).toEqual([
      'keys.normal."g": hides "gt" (tab.next), "gT" (tab.prev), "gg" (scroll.top), "gb" (bookmarks.open)',
    ]);
    expect(problems(build('[keys.normal]\n"xx" = "tab.new"'))).toEqual([
      'keys.normal."xx": hidden by "x" (tab.close)',
    ]);
  });

  test("two spellings of one key in the same file: the later wins", () => {
    const built = build('[keys.normal]\n"<C-d>" = "tab.new"\n"<C-D>" = "tab.close"');

    expect(problems(built)).toEqual(['keys.normal."<C-D>": same key as "<C-d>"; this one wins']);
    expect(lines(built)).toContain("normal <C-D> tab.close");
    expect(lines(built)).not.toContain("normal <C-d> tab.new");

    const mac = build(
      '[keys.chords]\n"Mod+K" = "tab.new"\n"Meta+K" = "tab.close"',
      "vim",
      "darwin",
    );

    expect(problems(mac)).toEqual(['keys.chords."Meta+K": same key as "Mod+K"; this one wins']);
  });

  test("a later spelling that cannot bind does not claim to win", () => {
    const built = build('[keys.normal]\n"<C-d>" = "tab.new"\n"<C-D>" = "tab.qiut"');

    expect(problems(built)).toEqual(['keys.normal."<C-D>": no command "tab.qiut"']);
    expect(lines(built)).toContain("normal <C-d> tab.new");
  });

  test("a later spelling that unbinds does win", () => {
    const built = build('[keys.normal]\n"<C-d>" = "tab.new"\n"<C-D>" = ""');

    expect(problems(built)).toEqual(['keys.normal."<C-D>": same key as "<C-d>"; this one wins']);
    expect(lines(built).some((line) => line.startsWith("normal <C-d>"))).toBe(false);
  });

  test("a modifier on its own is not a key, in any table", () => {
    const built = build(
      '[keys.normal]\n"<Shift>" = "tab.new"\n"<C-CapsLock>" = "tab.new"\n[keys.chords]\n"Ctrl+Shift" = "tab.new"',
    );

    expect(problems(built)).toEqual([
      'keys.normal."<Shift>": a modifier on its own is not a key',
      'keys.normal."<C-CapsLock>": a modifier on its own is not a key',
      'keys.chords."Ctrl+Shift": a modifier on its own is not a key',
    ]);
  });

  test("a chord hides a modal key it shares a key with", () => {
    const built = build(`
      [keys.normal]
      "<C-d>" = "scroll.half-down"
      [keys.chords]
      "Ctrl+D" = "bookmark.toggle"
    `);

    expect(problems(built)).toEqual(['keys.normal."<C-d>": hidden by chord "Ctrl+D"']);
  });

  test("a chord with no Ctrl, Alt or Meta is refused, unless it is a function key", () => {
    const built = build('[keys.chords]\n"j" = "scroll.down"\n"Shift+F2" = "tab.new"');

    expect(problems(built)).toEqual([
      'keys.chords."j": needs Ctrl, Alt or Meta, or it would take the key from every text field',
    ]);
    expect(lines(built)).toEqual(expect.arrayContaining(["chords Shift+F2 tab.new"]));
    expect(lines(built)).not.toContain("chords j scroll.down");
  });

  test("an unknown table, or a table that is not one", () => {
    expect(problems(build('[keys.visual]\n"v" = "tab.new"'))).toEqual([
      'keys.visual: unknown key; expected "normal", "insert", "hint", "prompt", "chords"',
    ]);
    expect(problems(build('[keys]\nnormal = "j"'))).toEqual(["keys.normal: not a table"]);
    expect(problems(buildKeymap("vim", [{ keys: 3 }], "linux"))).toEqual(["keys: not a table"]);
  });

  test("a problem in a preset file names the file", () => {
    const built = buildKeymap(
      "vim",
      [layer('[keys.normal]\n"q" = "nope"', "keymaps/mine.toml")],
      "linux",
    );

    expect(problems(built)).toEqual(['keymaps/mine.toml: keys.normal."q": no command "nope"']);
  });
});
