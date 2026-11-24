import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path } from "effect";
import { expect, test } from "vite-plus/test";

// Read from disk: the test runner hands CSS imports over empty, `?raw` included.
const root = fileURLToPath(new URL("../../..", import.meta.url));

interface Source {
  path: string;
  text: string;
}

/** Every file matching the patterns, comments stripped. A read failure fails the whole file. */
const read = (...patterns: string[]): Promise<Source[]> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const paths = yield* Effect.forEach(patterns, (pattern) => fs.glob(pattern, { root }));

    return yield* Effect.forEach(paths.flat(), (file) =>
      fs
        .readFileString(path.join(root, file))
        .pipe(Effect.map((text) => ({ path: file, text: text.replace(/\/\*[\s\S]*?\*\//g, "") }))),
    );
  }).pipe(Effect.provide(NodeServices.layer), Effect.runPromise);

const TOKENS = "src/shared/styles/tokens.css";
const RECIPES = "src/main/recipes/";
const stylesheets = await read("src/**/*.css", "public/*/style.css");
const components = await read("src/**/*.svelte");
const scripts = (await read("src/**/*.ts")).filter(({ path }) => !path.endsWith(".test.ts"));

test("the inventory found the stylesheets it checks", () => {
  expect(stylesheets.map(({ path }) => path)).toContain(TOKENS);
  expect(stylesheets.map(({ path }) => path)).toContain(`${RECIPES}tui.css`);
  expect(components.length).toBeGreaterThan(0);
});

const declarations = (text: string): Array<[property: string, value: string]> =>
  [...text.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)].map(([, property = "", value = ""]) => [
    property,
    value.trim(),
  ]);

const COLOUR_LITERAL = new RegExp(
  [
    String.raw`#[0-9a-f]{3,8}\b`,
    String.raw`\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(`,
    String.raw`\b(?:black|white|red|green|blue|yellow|orange|purple|pink|brown|gr[ae]y|silver|cyan|magenta|navy|teal|maroon|olive|lime|aqua|fuchsia)\b`,
  ].join("|"),
  "i",
);

const FRAME_PROPERTY =
  /^(?:border(?:-(?:top|right|bottom|left))?(?:-(?:color|width|style))?|border-radius|outline|box-shadow)$/;

/** What is left of a value once every `var(...)`, however nested, is taken out. */
function withoutVars(value: string): string {
  let rest = value;

  for (let before = ""; before !== rest;) {
    before = rest;
    rest = rest.replace(/var\([^()]*\)/g, "");
  }

  return rest.trim();
}

// A built-in recipe is token values, like tokens.css, so it may hold literals.
const isRecipe = (path: string): boolean => path.startsWith(RECIPES);
const outsideTokens = stylesheets.filter(({ path }) => path !== TOKENS && !isRecipe(path));

test("built-in recipes set only tokens tokens.css declares, and the colour scheme", () => {
  const tokens = stylesheets.find(({ path }) => path === TOKENS)?.text ?? "";
  const declared = new Set(declarations(tokens).map(([property]) => property));

  const found = stylesheets
    .filter(({ path }) => isRecipe(path))
    .flatMap(({ path, text }) =>
      declarations(text)
        .filter(([property]) => property !== "color-scheme" && !declared.has(property))
        .map(([property]) => `${path}: ${property}`),
    );

  expect(found).toEqual([]);
});

test("stylesheets outside tokens.css carry no colour literals", () => {
  const found = outsideTokens.flatMap(({ path, text }) =>
    declarations(text)
      .filter(([, value]) => COLOUR_LITERAL.test(value.replace(/"[^"]*"/g, "")))
      .map(([property, value]) => `${path}: ${property}: ${value}`),
  );

  expect(found).toEqual([]);
});

test("borders, outlines, radii and shadows outside tokens.css come from tokens", () => {
  const found = outsideTokens.flatMap(({ path, text }) =>
    declarations(text)
      .filter(([property]) => FRAME_PROPERTY.test(property))
      .filter(([, value]) => !["", "none", "0"].includes(withoutVars(value)))
      .map(([property, value]) => `${path}: ${property}: ${value}`),
  );

  expect(found).toEqual([]);
});

test("every --kv-* token read anywhere is declared somewhere", () => {
  const all = [...stylesheets, ...components, ...scripts];

  const declared = new Set(
    all.flatMap(({ text }) =>
      [...text.matchAll(/(--kv-[a-z0-9-]+)\s*:|style:(--kv-[a-z0-9-]+)/g)].map(
        ([, name, bound]) => name ?? bound ?? "",
      ),
    ),
  );

  // A name ending in a dash is built at runtime, like the per-kind badge colours.
  const undeclared = all.flatMap(({ path, text }) =>
    [...text.matchAll(/var\(\s*(--kv-[a-z0-9-]+)/g)].flatMap(([, name = ""]) =>
      name.endsWith("-") || declared.has(name) ? [] : [`${path}: ${name}`],
    ),
  );

  expect([...new Set(undeclared)]).toEqual([]);
});

test("every surface declares the same layer order", () => {
  const orders = [...stylesheets, ...scripts].flatMap(({ path, text }) =>
    [...text.matchAll(/@layer\s+([a-z.]+(?:\s*,\s*[a-z.]+)+)\s*;/g)].map(([, order = ""]) => ({
      path,
      order: order.replace(/\s+/g, ""),
    })),
  );

  expect(orders.length).toBeGreaterThanOrEqual(5);

  for (const { path, order } of orders) {
    expect({ path, order }).toEqual({
      path,
      order: "kvist.reset,kvist.tokens,kvist.recipe,kvist.components",
    });
  }
});
