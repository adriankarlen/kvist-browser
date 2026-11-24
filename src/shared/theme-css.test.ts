import { expect, test } from "vite-plus/test";
import { themeCss } from "./theme-css";

test("the recipe goes in its layer, and config.css follows it unlayered", () => {
  const css = themeCss({
    css: ".a { color: red; }",
    recipe: { name: "x", css: ":root { --b: 1; }" },
  });

  expect(css).toBe("@layer kvist.recipe {\n:root { --b: 1; }\n}\n.a { color: red; }");
});
