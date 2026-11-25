import { isDeepStrictEqual } from "node:util";
import { Result } from "effect";
import { Toml } from "effect/encoding";
import type { Table } from "./toml-fields";

const TABLE_HEADER = /^\s*\[/;

/** A top-level `recipe = ...` line: what precedes the value, the value, and what follows it. */
const RECIPE_LINE = /^(\s*recipe\s*=\s*)("[^"]*"|'[^']*'|[^#\r]*?)(\s*(?:#.*)?\r?)$/;

const withoutRecipe = ({ recipe: _recipe, ...rest }: Table): Table => rest;

/** The line edit itself: replace the top-level `recipe` value, or add one as the first line. */
function editRecipeLine(source: string, name: string): string {
  const lines = source.split("\n");
  const firstTable = lines.findIndex((line) => TABLE_HEADER.test(line));
  const topLevel = firstTable === -1 ? lines.length : firstTable;

  for (let index = 0; index < topLevel; index++) {
    const match = RECIPE_LINE.exec(lines[index]!);

    if (match) {
      lines[index] = `${match[1]}"${name}"${match[3]}`;

      return lines.join("\n");
    }
  }

  const eol = source.includes("\r\n") ? "\r\n" : "\n";

  return source === "" ? `recipe = "${name}"${eol}` : `recipe = "${name}"${eol}${source}`;
}

/**
 * config.toml with `recipe` set to `name` and every other byte kept. A line
 * edit is not a TOML writer, so the result must parse, name the recipe, and
 * mean the same otherwise. Anything else is refused.
 */
export function withRecipe(source: string, name: string): Result.Result<string, string> {
  const before = Toml.parse(source);

  if (Result.isFailure(before)) return Result.fail("config.toml has an error; fix it first");

  const edited = editRecipeLine(source, name);
  const after = Toml.parse(edited);

  const unchanged =
    Result.isSuccess(after) &&
    after.success.recipe === name &&
    isDeepStrictEqual(withoutRecipe(after.success), withoutRecipe(before.success));

  return unchanged
    ? Result.succeed(edited)
    : Result.fail("could not set recipe in config.toml; set it by hand");
}
