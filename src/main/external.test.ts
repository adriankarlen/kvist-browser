import { expect, test } from "vite-plus/test";
import { externalProtocolTarget } from "./external";

test("allowlisted schemes are handed off", () => {
  expect(externalProtocolTarget("mailto:foo@bar.com")).toBe("mailto");
  expect(externalProtocolTarget("tel:+46701234567")).toBe("tel");
  expect(externalProtocolTarget("sms:+15551234567")).toBe("sms");
  expect(externalProtocolTarget("webcal://example.com/cal.ics")).toBe("webcal");
  expect(externalProtocolTarget("geo:59.3,18.0")).toBe("geo");
  expect(externalProtocolTarget("magnet:?xt=urn:btih:abc")).toBe("magnet");
  expect(externalProtocolTarget("ftp://example.com/file")).toBe("ftp");
});

test("web, kvist, and dangerous schemes are not handed off", () => {
  for (const url of [
    "https://example.com",
    "http://example.com",
    "kvist://newtab/",
    "kvist://error/?url=x",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,x",
    "about:blank",
    "view-source:http://x",
    "shell:cmd",
  ]) {
    expect(externalProtocolTarget(url)).toBeNull();
  }
});

test("a non-URL is not handed off", () => {
  expect(externalProtocolTarget("not a url")).toBeNull();
  expect(externalProtocolTarget("")).toBeNull();
});

test("scheme case is normalized before lookup", () => {
  expect(externalProtocolTarget("MAILTO:foo@bar.com")).toBe("mailto");
  expect(externalProtocolTarget("Tel:+46701234567")).toBe("tel");
});
