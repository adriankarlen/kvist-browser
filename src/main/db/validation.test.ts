import { Schema } from "effect";
import { expect, test } from "vite-plus/test";
import { epochMillis, nonEmptyString, parse, parseAll, urlString } from "./validation";

test("parse returns the value on success", () => {
  const result = parse(urlString, "https://example.com");

  expect(result).toEqual({ value: "https://example.com", problem: undefined });
});

test("parse returns a Problem on failure, with the path as field", () => {
  const result = parse(urlString, "not a url");

  expect(result.value).toBeUndefined();
  expect(result.problem).toEqual({ field: "<root>", reason: "not a url" });
});

test("parseAll collects every failure, not just the first", () => {
  const schema = Schema.Struct({
    name: Schema.NonEmptyString,
    age: Schema.Number.check(Schema.isGreaterThan(0)),
  });

  const result = parseAll(schema, { name: "", age: -1 });

  expect("value" in result).toBe(false);
  expect(result.problems.map((p) => p.field).sort()).toEqual(["age", "name"]);
});

test("nested paths read as dotted fields with bracketed indices", () => {
  const schema = Schema.Struct({ links: Schema.Array(Schema.Struct({ url: Schema.String })) });

  expect(parse(schema, { links: [{ url: "a" }, { url: 1 }] }).problem?.field).toBe("links[1].url");
});

test("nonEmptyString rejects empty strings", () => {
  expect(parse(nonEmptyString, "ok").problem).toBeUndefined();
  expect(parse(nonEmptyString, "").problem).toBeDefined();
});

test("epochMillis rejects negative and fractional numbers", () => {
  expect(parse(epochMillis, 0).problem).toBeUndefined();
  expect(parse(epochMillis, Date.now()).problem).toBeUndefined();
  expect(parse(epochMillis, -1).problem).toBeDefined();
  expect(parse(epochMillis, 1.5).problem).toBeDefined();
});
