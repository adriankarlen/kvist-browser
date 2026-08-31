import { type } from "arktype";
import { expect, test } from "vite-plus/test";
import { createSelectSchema } from "drizzle-arktype";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { epochMillis, nonEmptyString, parse, parseAll, urlString } from "./validation";

test("parse returns the value on success", () => {
  const result = parse(urlString, "https://example.com");
  expect(result.problem).toBeUndefined();
  if (result.problem !== undefined) return;
  expect(result.value).toBe("https://example.com");
});

test("parse returns a Problem on failure, with the path as field", () => {
  const result = parse(urlString, "not a url");
  expect(result.value).toBeUndefined();
  if (result.value !== undefined) return;
  expect(result.problem.field).toBe("<root>");
  expect(result.problem.reason).toMatch(/url/i);
});

test("parseAll collects every failure, not just the first", () => {
  const validator = type({ name: "string > 0", age: "number > 0" });
  const result = parseAll(validator, { name: "", age: -1 });
  expect("problems" in result).toBe(true);
  if (!("problems" in result)) return;
  expect(result.problems).toHaveLength(2);
  expect(result.problems.map((p) => p.field).sort()).toEqual(["age", "name"]);
});

test("nonEmptyString rejects empty strings", () => {
  expect(parse(nonEmptyString, "ok").problem).toBeUndefined();
  const result = parse(nonEmptyString, "");
  expect(result.problem).toBeDefined();
});

test("epochMillis rejects negative integers", () => {
  expect(parse(epochMillis, 0).problem).toBeUndefined();
  expect(parse(epochMillis, Date.now()).problem).toBeUndefined();
  const result = parse(epochMillis, -1);
  expect(result.problem).toBeDefined();
});

test("a Drizzle-derived validator plugs into parse and rejects malformed rows", () => {
  // A Drizzle table is just the schema; `createSelectSchema` derives an
  // ArkType validator for the row shape. The integration is the point: a
  // future row reader gets a typed validator without writing one by hand.
  const widgets = sqliteTable("widgets", {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
  });
  const widgetRow = createSelectSchema(widgets);

  const ok = parse(widgetRow, { id: 1, name: "spinner" });
  expect(ok.problem).toBeUndefined();
  if (ok.problem !== undefined) return;
  expect(ok.value).toEqual({ id: 1, name: "spinner" });

  // Missing a required column (`name`) — the validator should reject.
  const bad = parse(widgetRow, { id: 1 });
  expect(bad.problem).toBeDefined();
});
