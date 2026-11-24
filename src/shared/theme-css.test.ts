import { expect, test } from "vite-plus/test";
import { themeCss } from "./theme-css";

test("config.css comes first, so its @import stays valid, and the recipe follows in its layer", () => {
  const css = themeCss({
    css: ".a { color: red; }",
    recipe: { name: "x", css: ":root { --b: 1; }" },
  });

  expect(css).toBe(".a { color: red; }\n@layer kvist.recipe {\n:root { --b: 1; }\n}\n");
});
