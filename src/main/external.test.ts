import { expect, test } from "vite-plus/test";
import { externalProtocolTarget, looksLikeHostPort } from "./external";

test("schemes Chromium loads itself are not a hand-off candidate", () => {
  for (const url of [
    "https://example.com",
    "http://example.com",
    "kvist://newtab/",
    "kvist://error/?url=x",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,x",
    "blob:https://example.com/abc",
    "filesystem:https://example.com/temporary/x",
    "about:blank",
    "chrome://settings",
    "chrome-extension://abc/page.html",
    "devtools://devtools/bundled/inspector.html",
    "view-source:http://x",
  ]) {
    expect(externalProtocolTarget(url)).toBeNull();
  }
});

test("any other scheme is a hand-off candidate — not just a fixed shortlist", () => {
  // There is no way to enumerate every native-app scheme a site might hand
  // off to in advance (bankid, whatsapp, zoommtg, ...), so anything that is
  // not one of the schemes above is a candidate. Whether it is actually
  // opened is `ExternalProtocols`' call, not this function's.
  expect(externalProtocolTarget("mailto:foo@bar.com")).toBe("mailto");
  expect(externalProtocolTarget("tel:+46701234567")).toBe("tel");
  expect(externalProtocolTarget("sms:+15551234567")).toBe("sms");
  expect(externalProtocolTarget("webcal://example.com/cal.ics")).toBe("webcal");
  expect(externalProtocolTarget("geo:59.3,18.0")).toBe("geo");
  expect(externalProtocolTarget("magnet:?xt=urn:btih:abc")).toBe("magnet");
  expect(externalProtocolTarget("ftp://example.com/file")).toBe("ftp");
  expect(externalProtocolTarget("bankid:///?autostarttoken=abc&redirect=null")).toBe("bankid");
  expect(externalProtocolTarget("shell:cmd")).toBe("shell");
  // A bare host:port is syntactically a scheme too — looksLikeHostPort is
  // what tells these apart from a real one, not this function.
  expect(externalProtocolTarget("localhost:3000")).toBe("localhost");
});

test("a non-URL is not a hand-off candidate", () => {
  expect(externalProtocolTarget("not a url")).toBeNull();
  expect(externalProtocolTarget("")).toBeNull();
});

test("scheme case is normalized before lookup", () => {
  expect(externalProtocolTarget("MAILTO:foo@bar.com")).toBe("mailto");
  expect(externalProtocolTarget("Tel:+46701234567")).toBe("tel");
});

test("a typed host:port is indistinguishable from a bare scheme", () => {
  // resolveUrl's HAS_SCHEME regex already treats "localhost:3000" as if it
  // had a scheme, and a non-special scheme's URL has no hostname either
  // way — so this is the only signal left to tell them apart.
  expect(looksLikeHostPort("localhost:3000")).toBe(true);
  expect(looksLikeHostPort("localhost:3000/foo")).toBe(true);
  expect(looksLikeHostPort("localhost:3000/foo?bar=1")).toBe(true);
  expect(looksLikeHostPort("example.com:8080")).toBe(true);
  expect(looksLikeHostPort("example.com:8080/path")).toBe(true);
});

test("a real scheme's payload does not look like a host:port", () => {
  expect(looksLikeHostPort("mailto:foo@bar.com")).toBe(false);
  expect(looksLikeHostPort("bankid:///?autostarttoken=abc")).toBe(false);
  expect(looksLikeHostPort("geo:59.3,18.0")).toBe(false);
  expect(looksLikeHostPort("magnet:?xt=urn:btih:abc")).toBe(false);
  // webcal/ftp parse with a real authority (non-empty hostname), so they
  // are never ambiguous with a bare host:port in the first place.
  expect(looksLikeHostPort("webcal://example.com/cal.ics")).toBe(false);
  expect(looksLikeHostPort("ftp://example.com/file")).toBe(false);
});

test("a digits-only payload alone is not enough — the scheme word must look like a host", () => {
  // tel:, sms:, and any other bare-word scheme parse with an empty hostname
  // and can have an all-digit path too (a phone number, an emergency
  // number) — indistinguishable from host:port on path shape alone. Only
  // a dotted name or the literal "localhost" counts as host-shaped.
  expect(looksLikeHostPort("tel:123")).toBe(false);
  expect(looksLikeHostPort("tel:0701234567")).toBe(false);
  expect(looksLikeHostPort("sms:112")).toBe(false);
});

test("a non-URL does not look like a host:port", () => {
  expect(looksLikeHostPort("not a url")).toBe(false);
});
