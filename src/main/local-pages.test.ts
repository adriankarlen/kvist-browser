import { expect, test } from "vite-plus/test";
import { resolveSearch } from "./local-pages";

const SEARCH = "https://search.example/?q={q}";

test("the new tab search passes an address through and searches for anything else", () => {
  expect(resolveSearch("https://kvist.dev/", SEARCH)).toEqual({ url: "https://kvist.dev/" });
  expect(resolveSearch("kvist.dev", SEARCH)).toEqual({ url: "https://kvist.dev" });
  expect(resolveSearch("rose pine", SEARCH)).toEqual({
    url: "https://search.example/?q=rose%20pine",
  });
});

test("blank text goes nowhere", () => {
  expect(resolveSearch("   ", SEARCH)).toEqual({ url: null });
});
