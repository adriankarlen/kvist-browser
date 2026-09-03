import { expect, test, vi } from "vite-plus/test";
import type { PromptState } from "../shared/ipc";
import { ExternalProtocols, externalProtocolTarget, looksLikeHostPort } from "./external";
import type { PageContents } from "./page-host";
import { Prompts } from "./prompts";

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

test("a non-URL does not look like a host:port", () => {
  expect(looksLikeHostPort("not a url")).toBe(false);
});

type PromptHead = { id: number; state: PromptState };

/** A stand-in tab: enough of `PageContents` to test acquiring and releasing a `destroyed` watch. */
function fakeContents() {
  const listeners = new Set<() => void>();
  let destroyed = false;
  // SAFETY: partial stub — ExternalProtocols only reaches once/removeListener.
  const contents = {
    once: (_event: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeListener: (_event: string, listener: () => void) => {
      listeners.delete(listener);
    },
  } as unknown as PageContents;
  return {
    contents,
    destroy: () => {
      destroyed = true;
      const firing = [...listeners];
      listeners.clear();
      for (const listener of firing) listener();
    },
    isDestroyed: () => destroyed,
    listenerCount: () => listeners.size,
  };
}

function createExternalProtocols() {
  const prompts = new Prompts<PromptState>();
  const open = vi.fn<(url: string) => void>();
  const warn = vi.fn<(text: string) => void>();
  const externalProtocols = new ExternalProtocols(prompts, open, warn);
  const seen: (PromptHead | null)[] = [];
  externalProtocols.observe((head) => seen.push(head));
  return { externalProtocols, open, warn, seen, prompts };
}

/** `request`'s `selfInitiated` value for tests that only care about a page asking. */
const PAGE_ASKED = false;

test("a scheme nobody has answered for queues a prompt and opens nothing yet", () => {
  const { externalProtocols, open, seen } = createExternalProtocols();
  const { contents } = fakeContents();

  externalProtocols.request(
    "bankid:///?autostarttoken=abc",
    "bankid",
    "https://id.example.com",
    PAGE_ASKED,
    contents,
  );

  expect(open).not.toHaveBeenCalled();
  expect(externalProtocols.pending).toEqual([
    {
      id: 1,
      state: {
        kind: "external-protocol",
        origin: "https://id.example.com",
        scheme: "bankid",
        url: "bankid:///?autostarttoken=abc",
      },
    },
  ]);
  // Subscribe fires with null immediately, then again on the ask.
  expect(seen).toHaveLength(2);
});

test("allowing opens the URL and remembers the decision for that origin and scheme", () => {
  const { externalProtocols, open } = createExternalProtocols();
  const { contents } = fakeContents();

  externalProtocols.request(
    "bankid:///?autostarttoken=abc",
    "bankid",
    "https://id.example.com",
    PAGE_ASKED,
    contents,
  );
  externalProtocols.answerHead(true);

  expect(open).toHaveBeenCalledWith("bankid:///?autostarttoken=abc");

  open.mockClear();
  externalProtocols.request(
    "bankid:///?autostarttoken=xyz",
    "bankid",
    "https://id.example.com",
    PAGE_ASKED,
    contents,
  );
  expect(open).toHaveBeenCalledWith("bankid:///?autostarttoken=xyz");
  expect(externalProtocols.pending).toEqual([]);
});

test("denying is remembered too, and warns instead of doing nothing silently", () => {
  const { externalProtocols, open, warn } = createExternalProtocols();
  const { contents } = fakeContents();

  externalProtocols.request(
    "bankid:///a",
    "bankid",
    "https://id.example.com",
    PAGE_ASKED,
    contents,
  );
  externalProtocols.answerHead(false);
  expect(warn).not.toHaveBeenCalled();

  externalProtocols.request(
    "bankid:///b",
    "bankid",
    "https://id.example.com",
    PAGE_ASKED,
    contents,
  );
  expect(open).not.toHaveBeenCalled();
  expect(externalProtocols.pending).toEqual([]);
  expect(warn).toHaveBeenCalledWith(
    "bankid: is blocked for id.example.com — restart kvist to ask again",
  );
});

test("a remembered deny with no origin warns without naming a site", () => {
  const { externalProtocols, warn } = createExternalProtocols();

  externalProtocols.request("bankid:///a", "bankid", null, true, null);
  externalProtocols.answerHead(false);

  externalProtocols.request("bankid:///b", "bankid", null, true, null);
  expect(warn).toHaveBeenCalledWith("bankid: is blocked — restart kvist to ask again");
});

test("decisions are per origin and per scheme", () => {
  const { externalProtocols, open } = createExternalProtocols();
  const { contents } = fakeContents();

  externalProtocols.request(
    "bankid:///a",
    "bankid",
    "https://id.example.com",
    PAGE_ASKED,
    contents,
  );
  externalProtocols.answerHead(true);

  externalProtocols.request(
    "bankid:///a",
    "bankid",
    "https://other.example.com",
    PAGE_ASKED,
    contents,
  );
  externalProtocols.request(
    "tel:+46701234567",
    "tel",
    "https://id.example.com",
    PAGE_ASKED,
    contents,
  );

  expect(open).toHaveBeenCalledTimes(1);
  expect(externalProtocols.pending).toHaveLength(2);
});

test("no attributable origin still asks, and is remembered on its own", () => {
  const { externalProtocols, open } = createExternalProtocols();
  const { contents } = fakeContents();

  externalProtocols.request("mailto:foo@bar.com", "mailto", null, true, contents);
  expect(externalProtocols.pending).toEqual([
    {
      id: 1,
      state: {
        kind: "external-protocol",
        origin: null,
        scheme: "mailto",
        url: "mailto:foo@bar.com",
      },
    },
  ]);

  externalProtocols.answerHead(true);
  expect(open).toHaveBeenCalledWith("mailto:foo@bar.com");

  open.mockClear();
  externalProtocols.request("mailto:bar@baz.com", "mailto", null, true, contents);
  expect(open).toHaveBeenCalledWith("mailto:bar@baz.com");
});

test("the user's own typing and an unattributable page do not share a decision", () => {
  // Both carry origin: null, but an allow granted while the user typed a
  // mailto: directly must not silently cover a kvist:/file:/opaque page's
  // own, unrelated request for the same scheme.
  const { externalProtocols, open } = createExternalProtocols();
  const { contents } = fakeContents();

  externalProtocols.request("mailto:self@example.com", "mailto", null, true, contents);
  externalProtocols.answerHead(true);

  externalProtocols.request("mailto:page@example.com", "mailto", null, false, contents);
  expect(externalProtocols.pending).toHaveLength(1);
  expect(open).not.toHaveBeenCalledWith("mailto:page@example.com");
});

test("a repeated ask for the same origin, scheme, and asker joins the prompt already up", () => {
  const { externalProtocols, open, seen } = createExternalProtocols();
  const { contents } = fakeContents();

  externalProtocols.request(
    "bankid:///a",
    "bankid",
    "https://id.example.com",
    PAGE_ASKED,
    contents,
  );
  externalProtocols.request(
    "bankid:///b",
    "bankid",
    "https://id.example.com",
    PAGE_ASKED,
    contents,
  );

  expect(externalProtocols.pending).toHaveLength(1);
  // Subscribe with null, then the first ask — the second joined without
  // changing the head.
  expect(seen).toHaveLength(2);

  externalProtocols.answerHead(true);
  expect(open.mock.calls).toEqual([["bankid:///a"], ["bankid:///b"]]);
});

test("a tab that dies mid-prompt is a denial nobody decided", () => {
  const { externalProtocols, open, seen } = createExternalProtocols();
  const { contents, destroy } = fakeContents();

  externalProtocols.request(
    "bankid:///a",
    "bankid",
    "https://id.example.com",
    PAGE_ASKED,
    contents,
  );
  destroy();

  expect(externalProtocols.pending).toEqual([]);
  expect(seen.at(-1)).toBeNull();

  const { contents: revived } = fakeContents();
  externalProtocols.request("bankid:///a", "bankid", "https://id.example.com", PAGE_ASKED, revived);
  expect(open).not.toHaveBeenCalled();
  expect(externalProtocols.pending).toHaveLength(1);
});

test("one tab dying does not strand a sibling tab's coalesced question", () => {
  const { externalProtocols, open } = createExternalProtocols();
  const first = fakeContents();
  const second = fakeContents();

  externalProtocols.request(
    "bankid:///a",
    "bankid",
    "https://id.example.com",
    PAGE_ASKED,
    first.contents,
  );
  externalProtocols.request(
    "bankid:///b",
    "bankid",
    "https://id.example.com",
    PAGE_ASKED,
    second.contents,
  );
  expect(externalProtocols.pending).toHaveLength(1);

  first.destroy();
  expect(externalProtocols.pending).toHaveLength(1);

  externalProtocols.answerHead(true);
  expect(open.mock.calls).toEqual([["bankid:///a"], ["bankid:///b"]]);
});

test("an unwatched request riding along survives every watched tab dying", () => {
  // The bug this guards against: a :tabnew mailto:x (no tab, nothing to
  // watch) coalescing onto the same ask as a watched tab's request used to
  // be dropped silently when that watched tab's death emptied the watcher
  // list — the unwatched request had never asked to be tied to that tab's
  // lifetime at all.
  const { externalProtocols, open } = createExternalProtocols();
  const { contents, destroy } = fakeContents();

  externalProtocols.request("mailto:unwatched@example.com", "mailto", null, true, null);
  externalProtocols.request("mailto:watched@example.com", "mailto", null, true, contents);
  expect(externalProtocols.pending).toHaveLength(1);

  destroy();
  // The watched request's tab died, but the unwatched one is still owed
  // an answer — the prompt must still be up.
  expect(externalProtocols.pending).toHaveLength(1);

  externalProtocols.answerHead(true);
  expect(open.mock.calls).toEqual([
    ["mailto:unwatched@example.com"],
    ["mailto:watched@example.com"],
  ]);
});

test("answering releases the destroyed listener it no longer needs", () => {
  const { externalProtocols } = createExternalProtocols();
  const { contents, listenerCount } = fakeContents();

  externalProtocols.request(
    "bankid:///a",
    "bankid",
    "https://id.example.com",
    PAGE_ASKED,
    contents,
  );
  expect(listenerCount()).toBe(1);

  externalProtocols.answerHead(true);
  expect(listenerCount()).toBe(0);
});

test("no contents at all (session restore, :tabnew) still asks, with nothing to watch", () => {
  const { externalProtocols, open } = createExternalProtocols();

  externalProtocols.request("bankid:///a", "bankid", null, true, null);
  expect(externalProtocols.pending).toHaveLength(1);

  externalProtocols.answerHead(true);
  expect(open).toHaveBeenCalledWith("bankid:///a");
});

test("external-protocol asks reach observers on the shared Prompts, not just the wrapper", () => {
  const prompts = new Prompts<PromptState>();
  const open = vi.fn<(url: string) => void>();
  const warn = vi.fn<(text: string) => void>();
  const externalProtocols = new ExternalProtocols(prompts, open, warn);
  const externalSeen: (PromptHead | null)[] = [];
  prompts.observe((head) => externalSeen.push(head));
  const { contents } = fakeContents();

  externalProtocols.request(
    "bankid:///a",
    "bankid",
    "https://id.example.com",
    PAGE_ASKED,
    contents,
  );

  expect(externalSeen).toHaveLength(2);
  expect(externalSeen.at(-1)).toMatchObject({
    state: { kind: "external-protocol", origin: "https://id.example.com", scheme: "bankid" },
  });
});
