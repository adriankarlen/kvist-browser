import { Result } from "effect";
import { expect, test } from "vite-plus/test";
import { withRecipe } from "./config-edit";

const edited = (source: string, name = "modern"): string => {
  const result = withRecipe(source, name);

  if (Result.isFailure(result)) throw new Error(result.failure);

  return result.success;
};

const refusal = (source: string): string | undefined => {
  const result = withRecipe(source, "modern");

  return Result.isFailure(result) ? result.failure : undefined;
};

test("an empty or missing file gets one line", () => {
  expect(edited("")).toBe('recipe = "modern"\n');
});

test("a file with no recipe gets it as the first line, and keeps the rest byte for byte", () => {
  const source = "# my config\nhomepage = 'https://a.b'\n\n[layout.tabs]\nsize = '20ch'\n";

  expect(edited(source)).toBe(`recipe = "modern"\n${source}`);
});

test("an existing recipe is replaced in place, with its comment and spacing", () => {
  expect(edited("# top\nrecipe   =  'tui'  # the look\nadblock = false\n")).toBe(
    '# top\nrecipe   =  "modern"  # the look\nadblock = false\n',
  );
});

test("only a top-level recipe counts; one inside a table is someone else's key", () => {
  const source = "[newtab]\nrecipe = 'soup'\n";

  expect(edited(source)).toBe(`recipe = "modern"\n${source}`);
});

test("CRLF files stay CRLF", () => {
  expect(edited("adblock = false\r\n")).toBe('recipe = "modern"\r\nadblock = false\r\n');
  expect(edited("recipe = 'tui'\r\nadblock = false\r\n")).toBe(
    'recipe = "modern"\r\nadblock = false\r\n',
  );
});

test("a value that is not a string is still replaced", () => {
  expect(edited("recipe = 3\n")).toBe('recipe = "modern"\n');
});

test("a file that does not parse is not touched", () => {
  expect(refusal("homepage = ")).toBe("config.toml has an error; fix it first");
});

test("an edit that would change anything else is refused", () => {
  // A dotted key the line edit cannot see; adding a second `recipe` would break the file.
  expect(refusal("recipe.x = 1\n")).toMatch(/set it by hand/);
  // A recipe line hidden in a multi-line string must not be rewritten.
  expect(refusal("note = '''\nrecipe = 'x'\n'''\n")).toMatch(/set it by hand/);
});
