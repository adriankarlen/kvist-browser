import { expect, test, vi } from "vite-plus/test";
import type { PromptState } from "../shared/ipc";
import { ExternalProtocols, externalProtocolTarget } from "./external";
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
});

test("a non-URL is not a hand-off candidate", () => {
  expect(externalProtocolTarget("not a url")).toBeNull();
  expect(externalProtocolTarget("")).toBeNull();
});

test("scheme case is normalized before lookup", () => {
  expect(externalProtocolTarget("MAILTO:foo@bar.com")).toBe("mailto");
  expect(externalProtocolTarget("Tel:+46701234567")).toBe("tel");
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
  const externalProtocols = new ExternalProtocols(prompts, open);
  const seen: (PromptHead | null)[] = [];
  externalProtocols.observe((head) => seen.push(head));
  return { externalProtocols, open, seen, prompts };
}

test("a scheme nobody has answered for queues a prompt and opens nothing yet", () => {
  const { externalProtocols, open, seen } = createExternalProtocols();
  const { contents } = fakeContents();

  externalProtocols.request(
    "bankid:///?autostarttoken=abc",
    "bankid",
    "https://id.example.com",
    contents,
  );

  expect(open).not.toHaveBeenCalled();
  expect(externalProtocols.pending).toEqual([
    {
      id: 1,
      state: { kind: "external-protocol", origin: "https://id.example.com", scheme: "bankid" },
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
    contents,
  );
  externalProtocols.answerHead(true);

  expect(open).toHaveBeenCalledWith("bankid:///?autostarttoken=abc");

  open.mockClear();
  externalProtocols.request(
    "bankid:///?autostarttoken=xyz",
    "bankid",
    "https://id.example.com",
    contents,
  );
  expect(open).toHaveBeenCalledWith("bankid:///?autostarttoken=xyz");
  expect(externalProtocols.pending).toEqual([]);
});

test("denying is remembered too, or the site would re-prompt on every click", () => {
  const { externalProtocols, open } = createExternalProtocols();
  const { contents } = fakeContents();

  externalProtocols.request("bankid:///a", "bankid", "https://id.example.com", contents);
  externalProtocols.answerHead(false);

  externalProtocols.request("bankid:///b", "bankid", "https://id.example.com", contents);
  expect(open).not.toHaveBeenCalled();
  expect(externalProtocols.pending).toEqual([]);
});

test("decisions are per origin and per scheme", () => {
  const { externalProtocols, open } = createExternalProtocols();
  const { contents } = fakeContents();

  externalProtocols.request("bankid:///a", "bankid", "https://id.example.com", contents);
  externalProtocols.answerHead(true);

  externalProtocols.request("bankid:///a", "bankid", "https://other.example.com", contents);
  externalProtocols.request("tel:+46701234567", "tel", "https://id.example.com", contents);

  expect(open).toHaveBeenCalledTimes(1);
  expect(externalProtocols.pending).toHaveLength(2);
});

test("no attributable origin still asks, and is remembered on its own", () => {
  const { externalProtocols, open } = createExternalProtocols();
  const { contents } = fakeContents();

  externalProtocols.request("mailto:foo@bar.com", "mailto", null, contents);
  expect(externalProtocols.pending).toEqual([
    { id: 1, state: { kind: "external-protocol", origin: null, scheme: "mailto" } },
  ]);

  externalProtocols.answerHead(true);
  expect(open).toHaveBeenCalledWith("mailto:foo@bar.com");

  open.mockClear();
  externalProtocols.request("mailto:bar@baz.com", "mailto", null, contents);
  expect(open).toHaveBeenCalledWith("mailto:bar@baz.com");
});

test("a repeated ask for the same origin and scheme joins the prompt already up", () => {
  const { externalProtocols, open, seen } = createExternalProtocols();
  const { contents } = fakeContents();

  externalProtocols.request("bankid:///a", "bankid", "https://id.example.com", contents);
  externalProtocols.request("bankid:///b", "bankid", "https://id.example.com", contents);

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

  externalProtocols.request("bankid:///a", "bankid", "https://id.example.com", contents);
  destroy();

  expect(externalProtocols.pending).toEqual([]);
  expect(seen.at(-1)).toBeNull();

  const { contents: revived } = fakeContents();
  externalProtocols.request("bankid:///a", "bankid", "https://id.example.com", revived);
  expect(open).not.toHaveBeenCalled();
  expect(externalProtocols.pending).toHaveLength(1);
});

test("one tab dying does not strand a sibling tab's coalesced question", () => {
  const { externalProtocols, open } = createExternalProtocols();
  const first = fakeContents();
  const second = fakeContents();

  externalProtocols.request("bankid:///a", "bankid", "https://id.example.com", first.contents);
  externalProtocols.request("bankid:///b", "bankid", "https://id.example.com", second.contents);
  expect(externalProtocols.pending).toHaveLength(1);

  first.destroy();
  expect(externalProtocols.pending).toHaveLength(1);

  externalProtocols.answerHead(true);
  expect(open.mock.calls).toEqual([["bankid:///a"], ["bankid:///b"]]);
});

test("answering releases the destroyed listener it no longer needs", () => {
  const { externalProtocols } = createExternalProtocols();
  const { contents, listenerCount } = fakeContents();

  externalProtocols.request("bankid:///a", "bankid", "https://id.example.com", contents);
  expect(listenerCount()).toBe(1);

  externalProtocols.answerHead(true);
  expect(listenerCount()).toBe(0);
});

test("no contents at all (session restore, :tabnew) still asks, with nothing to watch", () => {
  const { externalProtocols, open } = createExternalProtocols();

  externalProtocols.request("bankid:///a", "bankid", null, null);
  expect(externalProtocols.pending).toHaveLength(1);

  externalProtocols.answerHead(true);
  expect(open).toHaveBeenCalledWith("bankid:///a");
});

test("external-protocol asks reach observers on the shared Prompts, not just the wrapper", () => {
  const prompts = new Prompts<PromptState>();
  const open = vi.fn<(url: string) => void>();
  const externalProtocols = new ExternalProtocols(prompts, open);
  const externalSeen: (PromptHead | null)[] = [];
  prompts.observe((head) => externalSeen.push(head));
  const { contents } = fakeContents();

  externalProtocols.request("bankid:///a", "bankid", "https://id.example.com", contents);

  expect(externalSeen).toHaveLength(2);
  expect(externalSeen.at(-1)).toMatchObject({
    state: { kind: "external-protocol", origin: "https://id.example.com", scheme: "bankid" },
  });
});
