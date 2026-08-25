import { expect, test } from "vite-plus/test";
import { DEFAULT_SEARCH_URL, resolveUrl } from "./url";

test("a URL with a scheme is returned as typed", () => {
  expect(resolveUrl("https://example.com")).toBe("https://example.com");
  expect(resolveUrl("kvist://newtab")).toBe("kvist://newtab");
});

test("a bare host is opened over https", () => {
  expect(resolveUrl("example.com")).toBe("https://example.com");
});

test("anything else goes to the default search template", () => {
  expect(DEFAULT_SEARCH_URL).toContain("{q}");
  expect(resolveUrl("some words")).toBe("https://duckduckgo.com/?q=some%20words");
});

test("a custom template has {q} replaced with the encoded query", () => {
  expect(resolveUrl("some words", "https://search.example/find?q={q}&lang=en")).toBe(
    "https://search.example/find?q=some%20words&lang=en",
  );
});

test("the query is encoded into the template, not concatenated", () => {
  expect(resolveUrl("a&b=c", "https://search.example/?q={q}")).toBe(
    "https://search.example/?q=a%26b%3Dc",
  );
});
