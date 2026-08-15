import { expect, test } from "vite-plus/test";
import { ERR_ABORTED, describeError, errorPageTarget, formatErrorPageUrl } from "./error-page";

test("ERR_ABORTED is Chromium's -3, the ordinary-navigation code", () => {
  expect(ERR_ABORTED).toBe(-3);
});

test("a formatted URL round-trips through errorPageTarget", () => {
  const info = {
    code: -105,
    description: "net::ERR_NAME_NOT_RESOLVED",
    url: "https://a.b/c?x=1&y=2",
  };
  expect(errorPageTarget(formatErrorPageUrl(info))).toEqual(info);
});

test("a crash round-trips with a null code", () => {
  const info = { code: null, description: "crashed", url: "https://a.b/" };
  expect(errorPageTarget(formatErrorPageUrl(info))).toEqual(info);
});

test("URLs that fail again — query strings and ports survive", () => {
  const info = { code: -102, description: "refused", url: "http://127.0.0.1:9/a?b=c&d=e" };
  expect(errorPageTarget(formatErrorPageUrl(info))).toEqual(info);
});

test("ordinary URLs are not error pages", () => {
  expect(errorPageTarget("https://example.com/")).toBeNull();
  expect(errorPageTarget("kvist://newtab/")).toBeNull();
  expect(errorPageTarget("not a url")).toBeNull();
});

test("a malformed error-page URL is rejected rather than half-read", () => {
  expect(errorPageTarget("kvist://error/?desc=oops")).toBeNull();
  expect(errorPageTarget("kvist://error/?code=x&url=https://a.b/")).toBeNull();
  expect(errorPageTarget("kvist://error/?code=-3&url=")).toBeNull();
});

test("known codes get a headline; the rest stay numeric", () => {
  expect(describeError(-105)).toBe("name not resolved");
  expect(describeError(-102)).toBe("connection refused");
  expect(describeError(-999)).toBe("error -999");
  expect(describeError(null)).toBe("renderer gone");
});
