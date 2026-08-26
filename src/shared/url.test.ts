import { expect, test } from "vite-plus/test";
import { DEFAULT_SEARCH_URL, originOf, resolveUrl } from "./url";

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

test("originOf returns the parsed origin for persistable schemes", () => {
  expect(originOf("https://example.com/path")).toBe("https://example.com");
  expect(originOf("https://example.com:8080/path")).toBe("https://example.com:8080");
  expect(originOf("http://example.com/")).toBe("http://example.com");
  expect(originOf("kvist://newtab")).toBe("kvist://newtab");
  expect(originOf("file:///home/user/x.html")).toBe("file://");
});

test("originOf returns null for opaque and unsupported origins", () => {
  expect(originOf("about:blank")).toBeNull();
  expect(originOf("data:text/html,hi")).toBeNull();
  expect(originOf("blob:https://example.com/abc")).toBeNull();
  expect(originOf("mailto:foo@bar.com")).toBeNull();
  expect(originOf("not a url")).toBeNull();
});
