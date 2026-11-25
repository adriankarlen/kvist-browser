import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { OUTPUT, renderIconsCss } from "./icons.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("icons.css is what the generator writes from the roles", () => {
  expect(readFileSync(join(root, OUTPUT), "utf8")).toBe(renderIconsCss(root));
});
