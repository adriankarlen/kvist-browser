import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { repoRunner, type RepoRunner } from "../db/test-repos";
import { clamp } from "../zoom";
import { ZoomRepo } from "./zoom-repo";

let runner: RepoRunner<ZoomRepo["Service"]>;

beforeEach(() => {
  runner = repoRunner(ZoomRepo, ZoomRepo.layer);
});

afterEach(() => runner.dispose());

const zoom = {
  get: (origin: string) => runner.run((repo) => repo.get(origin)),
  set: (origin: string, level: number) => runner.run((repo) => repo.set(origin, level)),
};

test("an origin with no saved level is at 0", () => {
  expect(zoom.get("https://a.example")).toBe(0);
});

test("a set level is read back, and a second set overwrites it", () => {
  zoom.set("https://a.example", 1);
  zoom.set("https://b.example", -1);
  zoom.set("https://a.example", 2);
  expect(zoom.get("https://a.example")).toBe(2);
  expect(zoom.get("https://b.example")).toBe(-1);
});

test("set clamps to Chromium's accepted range", () => {
  zoom.set("https://a.example", 99);
  zoom.set("https://b.example", -99);
  expect(zoom.get("https://a.example")).toBe(clamp(99));
  expect(zoom.get("https://b.example")).toBe(clamp(-99));
});

test("a non-finite level is ignored", () => {
  zoom.set("https://a.example", 1);
  zoom.set("https://a.example", Number.NaN);
  zoom.set("https://a.example", Number.POSITIVE_INFINITY);
  expect(zoom.get("https://a.example")).toBe(1);
});

test("clamp pins out-of-range values at the nearest edge", () => {
  expect(clamp(10)).toBe(5.7);
  expect(clamp(-10)).toBe(-2.8);
  expect(clamp(1.5)).toBe(1.5);
});
