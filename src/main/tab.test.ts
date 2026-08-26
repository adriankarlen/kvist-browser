import { EventEmitter } from "node:events";
import { expect, test, vi } from "vite-plus/test";
import { type FindResult, wire } from "../shared/ipc";
import { errorPageTarget, formatErrorPageUrl } from "./error-page";
import type { PageHost } from "./page-host";
import { Tab, type TabCallbacks } from "./tab";
import { ZoomStore } from "./zoom";

/**
 * The in-memory adapter at the `PageHost` seam. Records what a Tab asked
 * Chromium to do, and lets a test fire the events Chromium would have.
 */
function createHost() {
  const events = new EventEmitter();
  const loaded: string[] = [];
  const sent: { channel: string; payload?: unknown }[] = [];
  const finds: { query: string; options?: unknown }[] = [];
  const state = {
    url: "",
    canGoBack: false,
    canGoForward: false,
    requestId: 0,
    webContentsReads: 0,
  };
  const calls = { stopFind: 0, focus: 0, crash: 0, close: 0 };
  let zoomLevel = 0;
  const zoomHistory: number[] = [];
  let openHandler: ((details: { url: string; disposition: string }) => unknown) | undefined;

  const webContents = {
    on: (event: string, listener: (...args: unknown[]) => void) => events.on(event, listener),
    send: (channel: string, payload?: unknown) => sent.push({ channel, payload }),
    loadURL: (url: string) => {
      loaded.push(url);
      state.url = url;
      return Promise.resolve();
    },
    getURL: () => state.url,
    reload: () => {},
    navigationHistory: {
      canGoBack: () => state.canGoBack,
      canGoForward: () => state.canGoForward,
      goBack: () => {},
      goForward: () => {},
    },
    findInPage: (query: string, options?: unknown) => {
      finds.push({ query, options });
      return ++state.requestId;
    },
    stopFindInPage: () => void calls.stopFind++,
    focus: () => void calls.focus++,
    isFocused: () => true,
    sendInputEvent: () => {},
    cut: () => {},
    copy: () => {},
    paste: () => {},
    selectAll: () => {},
    inspectElement: () => {},
    close: () => void calls.close++,
    isDestroyed: () => false,
    forcefullyCrashRenderer: () => void calls.crash++,
    setWindowOpenHandler: (handler: (details: { url: string; disposition: string }) => unknown) => {
      openHandler = handler;
    },
    isDevToolsOpened: () => false,
    openDevTools: () => {},
    closeDevTools: () => {},
    insertCSS: () => Promise.resolve(""),
    removeInsertedCSS: () => Promise.resolve(),
    setZoomLevel: (level: number) => {
      zoomHistory.push(level);
      // Mock Chromium's clamp at the edges.
      if (level < -2.8) zoomLevel = -2.8;
      else if (level > 5.7) zoomLevel = 5.7;
      else zoomLevel = level;
    },
    getZoomLevel: () => zoomLevel,
  };

  // The session moving the level without the tab asking — a same-origin
  // sibling's zoom propagating — as opposed to a call the tab made itself.
  const setLiveZoom = (level: number): void => {
    zoomLevel = level;
  };

  // SAFETY: partial stub — Tab only touches the members defined here.
  const host = {
    get webContents() {
      state.webContentsReads++;
      return webContents;
    },
    setVisible: () => {},
    setBounds: () => {},
  } as unknown as PageHost;

  return {
    host,
    loaded,
    sent,
    finds,
    state,
    calls,
    emit: (event: string, ...args: unknown[]) => void events.emit(event, ...args),
    openWindow: (url: string, disposition = "foreground-tab") =>
      openHandler?.({ url, disposition }),
    getZoomLevel: () => zoomLevel,
    getZoomHistory: () => zoomHistory,
    setLiveZoom,
  };
}

function createTab(overrides: Partial<TabCallbacks> = {}, zoom?: ZoomStore) {
  const host = createHost();
  const callbacks: TabCallbacks = {
    changed: vi.fn(),
    died: vi.fn(),
    openRequest: vi.fn(),
    found: vi.fn(),
    editable: vi.fn(),
    inPageNavigation: vi.fn(),
    navigated: vi.fn(),
    key: vi.fn(() => false),
    copyText: vi.fn(),
    menuCss: () => ".kv-menu {}",
    externalRequest: vi.fn(),
    ...overrides,
  };
  return {
    tab: new Tab(1, host.host, callbacks, zoom ?? new ZoomStore(), "https://a.example"),
    host,
    callbacks,
  };
}

/** Chromium's listeners all take an event object first. */
const EVENT = {};

/** The `context-menu` params, with only the fields a test cares about set. */
const menuParams = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  x: 0,
  y: 0,
  linkURL: "",
  srcURL: "",
  mediaType: "none",
  isEditable: false,
  editFlags: {},
  selectionText: "",
  ...overrides,
});

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test("the snapshot follows the page", () => {
  const { tab, host } = createTab();

  host.emit("page-title-updated", EVENT, "Example");
  host.emit("did-stop-loading", EVENT);
  host.emit("page-favicon-updated", EVENT, ["https://a.example/icon.png"]);
  host.state.canGoBack = true;

  expect(tab.snapshot()).toEqual({
    id: 1,
    title: "Example",
    url: "https://a.example",
    favicon: "https://a.example/icon.png",
    loading: false,
    canGoBack: true,
    canGoForward: false,
    zoomLevel: 0,
  });
});

test("one failure reported twice renders one error page", () => {
  const { tab: _tab, host } = createTab();
  const fail = ["did-fail-load", "did-fail-provisional-load"];

  for (const event of fail) {
    host.emit(event, EVENT, -105, "ERR_NAME_NOT_RESOLVED", "https://gone.example", true);
  }

  expect(host.loaded).toHaveLength(1);
  expect(errorPageTarget(host.loaded[0]!)?.url).toBe("https://gone.example");
});

test("a retry of the same URL renders the error page again", () => {
  const { host } = createTab();
  const fail = (): void => {
    host.emit("did-fail-load", EVENT, -105, "ERR_NAME_NOT_RESOLVED", "https://gone.example", true);
  };

  fail();
  // The retry link navigates back to the URL that failed.
  host.emit("did-start-navigation", EVENT, "https://gone.example", false, true);
  fail();

  expect(host.loaded).toHaveLength(2);
});

test("loading the error page does not clear the dedupe", () => {
  const { host } = createTab();
  host.emit("did-fail-load", EVENT, -105, "ERR_NAME_NOT_RESOLVED", "https://gone.example", true);
  // Our own error page starting to load is a main-frame navigation too.
  host.emit("did-start-navigation", EVENT, host.loaded[0], false, true);
  host.emit(
    "did-fail-provisional-load",
    EVENT,
    -105,
    "ERR_NAME_NOT_RESOLVED",
    "https://gone.example",
    true,
  );

  expect(host.loaded).toHaveLength(1);
});

test("an error page that fails does not stack another on top", () => {
  const { host } = createTab();
  const errorUrl = formatErrorPageUrl({
    code: -105,
    description: "boom",
    url: "https://a.example",
  });

  host.emit("did-fail-load", EVENT, -105, "ERR_FAILED", errorUrl, true);

  expect(host.loaded).toEqual([]);
});

test("an aborted load and a sub-frame failure are not the tab's to explain", () => {
  const { host } = createTab();

  host.emit("did-fail-load", EVENT, -3, "ERR_ABORTED", "https://a.example", true);
  host.emit(
    "did-fail-load",
    EVENT,
    -105,
    "ERR_NAME_NOT_RESOLVED",
    "https://a.example/frame",
    false,
  );

  expect(host.loaded).toEqual([]);
});

test("a hung page is crashed so the failure has somewhere to render", () => {
  const { host } = createTab();
  host.emit("unresponsive", EVENT);
  expect(host.calls.crash).toBe(1);
});

test("a crashed renderer gets the error page, a clean exit does not", () => {
  const { host } = createTab();

  host.emit("render-process-gone", EVENT, { reason: "clean-exit" });
  expect(host.loaded).toEqual([]);

  host.emit("render-process-gone", EVENT, { reason: "crashed" });
  expect(errorPageTarget(host.loaded[0]!)?.description).toBe("crashed");
});

test("a stale find result is ignored", () => {
  const found = vi.fn<(result: FindResult | null) => void>();
  const { tab, host } = createTab({ found });

  tab.find("needle");
  const current = host.state.requestId;
  host.emit("found-in-page", EVENT, { requestId: current - 1, matches: 9, activeMatchOrdinal: 9 });
  expect(found).not.toHaveBeenCalled();

  host.emit("found-in-page", EVENT, { requestId: current, matches: 2, activeMatchOrdinal: 1 });
  expect(found).toHaveBeenCalledWith({ query: "needle", matches: 2, active: 1 });
});

test("navigating ends the search rather than merely forgetting it", () => {
  const found = vi.fn<(result: FindResult | null) => void>();
  const { tab, host } = createTab({ found });

  tab.find("needle");
  host.emit("did-navigate", EVENT);

  expect(host.calls.stopFind).toBe(1);
  expect(found).toHaveBeenLastCalledWith(null);
  expect(tab.findResult).toBeNull();
});

test("n and N continue the query the prompt left behind", () => {
  const { tab, host } = createTab();

  tab.findNext(true);
  expect(host.finds).toEqual([]);

  tab.find("needle");
  tab.findNext(false);
  expect(host.finds.at(-1)).toEqual({
    query: "needle",
    options: { forward: false, findNext: true },
  });
});

test("an emptied prompt stops the search", () => {
  const { tab, host } = createTab();
  tab.find("needle");
  tab.find("");
  expect(host.calls.stopFind).toBe(1);
});

test("window.open asks for a sibling once Chromium has left window creation", async () => {
  const openRequest = vi.fn<(url: string, background: boolean) => void>();
  const { host } = createTab({ openRequest });

  expect(host.openWindow("https://opened.example", "background-tab")).toEqual({ action: "deny" });
  expect(openRequest).not.toHaveBeenCalled();

  await flush();
  expect(openRequest).toHaveBeenCalledWith("https://opened.example", true);
});

test("a page that closed itself is reported once", async () => {
  const died = vi.fn();
  const { host } = createTab({ died });

  host.emit("destroyed");
  await flush();

  expect(died).toHaveBeenCalledTimes(1);
});

test("a tab closed by us does not report a death", async () => {
  const died = vi.fn();
  const { tab, host } = createTab({ died });

  tab.close();
  host.emit("destroyed");
  await flush();

  expect(host.calls.close).toBe(1);
  expect(died).not.toHaveBeenCalled();
});

test("a closed tab does not reach through the view for its page", () => {
  const { tab, host } = createTab();
  host.state.canGoBack = true;
  tab.close();

  const before = host.state.webContentsReads;
  expect(tab.snapshot()).toMatchObject({ canGoBack: false, canGoForward: false });
  expect(tab.committed).toBe(false);
  expect(tab.isFocused()).toBe(false);
  void tab.contents;
  // Reaching through a view for a destroyed webContents hangs the process, so
  // the reference taken at construction is the only one there ever is.
  expect(host.state.webContentsReads).toBe(before);
});

test("a closed tab reaches through to nothing", () => {
  const { tab, host } = createTab();
  tab.close();

  tab.navigate("https://b.example");
  tab.find("needle");
  tab.showHints();
  tab.scroll("down");
  tab.focus();
  tab.click({ x: 1, y: 2 });
  tab.reload();

  expect(host.loaded).toEqual([]);
  expect(host.sent).toEqual([]);
  expect(host.finds).toEqual([]);
  expect(host.calls.focus).toBe(0);
});

test("the context menu carries the styling of the moment", () => {
  const copyText = vi.fn<(text: string) => void>();
  const { tab, host } = createTab({ copyText, menuCss: () => ".kv-menu { color: red }" });

  host.emit("context-menu", EVENT, menuParams({ x: 10, y: 20, linkURL: "https://link.example" }));

  const menu = host.sent.at(-1)!;
  expect(menu.channel).toBe(wire("contextMenu"));
  expect(menu.payload).toMatchObject({ x: 10, y: 20, css: ".kv-menu { color: red }" });

  tab.pickContextMenu("link.copy");
  expect(copyText).toHaveBeenCalledWith("https://link.example");
});

test("a pick after the menu is gone does nothing", () => {
  const copyText = vi.fn<(text: string) => void>();
  const { tab, host } = createTab({ copyText });

  host.emit("context-menu", EVENT, menuParams({ linkURL: "https://link.example" }));
  host.emit("did-navigate", EVENT);

  tab.pickContextMenu("link.copy");
  expect(copyText).not.toHaveBeenCalled();
  // The document is gone, so no hide is sent to it either.
  expect(host.sent.filter(({ channel }) => channel === wire("contextMenu"))).toHaveLength(1);
});

test("keys reach the mode machine, and a consumed key is swallowed", () => {
  const key = vi.fn(() => true);
  const { host } = createTab({ key });
  const event = { preventDefault: vi.fn() };

  host.emit("before-input-event", event, {
    type: "keyDown",
    key: "j",
    control: false,
    alt: false,
    meta: false,
  });

  expect(key).toHaveBeenCalledWith({ key: "j", control: false, alt: false, meta: false }, "page");
  expect(event.preventDefault).toHaveBeenCalled();
});

test("a keyUp is not a keystroke", () => {
  const key = vi.fn(() => true);
  const { host } = createTab({ key });
  const event = { preventDefault: vi.fn() };

  host.emit("before-input-event", event, { type: "keyUp", key: "j" });

  expect(key).not.toHaveBeenCalled();
  expect(event.preventDefault).not.toHaveBeenCalled();
});

test("the strip shows the URL that failed, not the error page's own address", () => {
  const { tab, host } = createTab();

  host.emit("did-fail-load", EVENT, -105, "ERR_NAME_NOT_RESOLVED", "https://gone.example", true);
  host.emit("did-navigate", EVENT);

  expect(tab.snapshot().url).toBe("https://gone.example");
});

test("a history-API navigation is reported so URL-keyed rules can be reapplied", () => {
  const inPageNavigation = vi.fn();
  const { host } = createTab({ inPageNavigation });

  host.state.url = "https://a.example/two";
  host.emit("did-navigate-in-page", EVENT, "https://a.example/two", true);

  expect(inPageNavigation).toHaveBeenCalledWith(expect.anything(), "https://a.example/two");
});

test("a committed navigation is reported with the URL it landed on", () => {
  const navigated = vi.fn();
  const { host } = createTab({ navigated });

  host.state.url = "https://b.example/page";
  host.emit("did-navigate", EVENT);

  expect(navigated).toHaveBeenCalledWith(expect.anything(), "https://b.example/page");
});

test("an error page is reported as the wrapper it is, not the site that failed", () => {
  const navigated = vi.fn();
  const { host } = createTab({ navigated });

  host.emit("did-fail-load", EVENT, -105, "ERR_NAME_NOT_RESOLVED", "https://gone.example", true);
  host.emit("did-navigate", EVENT);

  // The strip shows the failed site, but a site's styles must not be injected
  // into our own error page.
  expect(navigated).toHaveBeenCalledWith(expect.anything(), host.loaded[0]);
  expect(errorPageTarget(host.loaded[0]!)?.url).toBe("https://gone.example");
});

test("a link click with an allowlisted scheme is handed off to the desktop", () => {
  const externalRequest = vi.fn<(url: string) => void>();
  const { host } = createTab({ externalRequest });

  const details = {
    url: "mailto:foo@bar.com",
    isMainFrame: true,
    preventDefault: vi.fn(),
  };
  host.emit("will-navigate", details);

  expect(details.preventDefault).toHaveBeenCalled();
  expect(externalRequest).toHaveBeenCalledWith("mailto:foo@bar.com");
  // The tab never starts navigating.
  expect(host.loaded).toEqual([]);
});

test("a link click with a non-allowlisted scheme navigates as usual", () => {
  const externalRequest = vi.fn<(url: string) => void>();
  const { host } = createTab({ externalRequest });

  const details = {
    url: "https://example.com/page",
    isMainFrame: true,
    preventDefault: vi.fn(),
  };
  host.emit("will-navigate", details);

  expect(details.preventDefault).not.toHaveBeenCalled();
  expect(externalRequest).not.toHaveBeenCalled();
});

test("a sub-frame navigation is not handed off, even for an allowlisted scheme", () => {
  const externalRequest = vi.fn<(url: string) => void>();
  const { host } = createTab({ externalRequest });

  host.emit("will-navigate", {
    url: "mailto:foo@bar.com",
    isMainFrame: false,
    preventDefault: vi.fn(),
  });

  expect(externalRequest).not.toHaveBeenCalled();
});

test("navigate() hands off an allowlisted scheme instead of loading it", () => {
  const externalRequest = vi.fn<(url: string) => void>();
  const { tab, host } = createTab({ externalRequest });

  tab.navigate("mailto:foo@bar.com");

  expect(externalRequest).toHaveBeenCalledWith("mailto:foo@bar.com");
  expect(host.loaded).toEqual([]);
});

test("navigate() still loads a regular URL", () => {
  const externalRequest = vi.fn<(url: string) => void>();
  const { tab, host } = createTab({ externalRequest });

  tab.navigate("https://example.com/page");

  expect(host.loaded).toEqual(["https://example.com/page"]);
  expect(externalRequest).not.toHaveBeenCalled();
});

test("a closed tab never reports an external handoff", () => {
  const externalRequest = vi.fn<(url: string) => void>();
  const { tab } = createTab({ externalRequest });

  tab.close();
  tab.navigate("mailto:foo@bar.com");

  expect(externalRequest).not.toHaveBeenCalled();
});

test("setZoomLevel passes through and reflects the clamped result", async () => {
  const { tab, host } = createTab();
  host.state.url = "https://example.com";

  const applied = tab.setZoomLevel(2);
  expect(applied).toBe(2);
  expect(tab.snapshot().zoomLevel).toBe(2);
  expect(host.getZoomHistory()).toEqual([2]);

  // Beyond the upper edge — Chromium clamps; the tab mirrors that.
  expect(tab.setZoomLevel(99)).toBeCloseTo(5.7, 5);
});

test("setZoomLevel on a closed tab is a no-op", () => {
  const { tab, host } = createTab();
  tab.close();
  expect(tab.setZoomLevel(1)).toBeNull();
  expect(host.getZoomHistory()).toEqual([]);
});

test("a main-frame navigation re-applies the saved zoom for the new origin", async () => {
  const zoom = new ZoomStore();
  zoom.set("https://example.com", 1.5);
  const { tab, host } = createTab({}, zoom);
  host.state.url = "https://example.com";
  host.emit("did-navigate", EVENT);

  expect(host.getZoomHistory()).toEqual([1.5]);
  expect(tab.snapshot().zoomLevel).toBe(1.5);
});

test("a navigation to an origin with no saved level leaves zoom alone", () => {
  const { tab, host } = createTab();
  host.state.url = "https://fresh.example";
  host.emit("did-navigate", EVENT);

  expect(host.getZoomHistory()).toEqual([]);
  expect(tab.snapshot().zoomLevel).toBe(0);
});

test("a navigation to an unzoomable origin does not call setZoomLevel", async () => {
  const { host } = createTab();
  host.state.url = "about:blank";
  host.emit("did-navigate", EVENT);

  expect(host.getZoomHistory()).toEqual([]);
});

test("zoom-changed reflects in the snapshot and is persisted", async () => {
  const zoom = new ZoomStore();
  const { tab, host } = createTab({}, zoom);
  host.state.url = "https://example.com";

  // Simulate Chromium reporting the level that resulted from our setZoomLevel.
  host.emit("zoom-changed", EVENT, "in");
  // The host mock updated getZoomLevel to 0 by default; the real flow goes
  // getZoomLevel() -> mirror. Drive the mock to a non-default first.
  tab.setZoomLevel(2);
  host.emit("zoom-changed", EVENT, "in");

  expect(tab.snapshot().zoomLevel).toBe(2);
  expect(zoom.get("https://example.com")).toBe(2);
});

test("zoom-changed on an unzoomable origin is not persisted", () => {
  const zoom = new ZoomStore();
  const { tab, host } = createTab({}, zoom);
  host.state.url = "about:blank";

  tab.setZoomLevel(1);
  host.emit("zoom-changed", EVENT, "in");

  expect(zoom.get("about:blank")).toBe(0);
});

test("an error page is reported as such until a real navigation starts", () => {
  const { tab, host } = createTab();
  expect(tab.showsErrorPage).toBe(false);

  host.emit("did-fail-load", EVENT, -105, "ERR_NAME_NOT_RESOLVED", "https://gone.example", true);
  expect(tab.showsErrorPage).toBe(true);

  // The error page's own load is a navigation to the wrapper — it must not
  // clear the flag.
  host.emit("did-start-navigation", EVENT, host.loaded[0]!, false, true);
  expect(tab.showsErrorPage).toBe(true);

  // Retrying the failed URL starts a real navigation, which does.
  host.emit("did-start-navigation", EVENT, "https://gone.example", false, true);
  expect(tab.showsErrorPage).toBe(false);
});

test("a Ctrl+wheel zoom on an error page is mirrored but never persisted", () => {
  const zoom = new ZoomStore();
  const { tab, host } = createTab({}, zoom);
  host.state.url = "https://gone.example";
  host.emit("did-fail-load", EVENT, -105, "ERR_NAME_NOT_RESOLVED", "https://gone.example", true);

  host.setLiveZoom(2);
  host.emit("zoom-changed", EVENT, "in");

  expect(tab.snapshot().zoomLevel).toBe(2);
  // Not under the wrapper's origin, and not under the failed site's either.
  expect(zoom.get("kvist://error")).toBe(0);
  expect(zoom.get("https://gone.example")).toBe(0);
});

test("syncZoom re-reads the level the session applied while the tab was hidden", () => {
  const { tab, host } = createTab();
  tab.setZoomLevel(1);
  expect(tab.snapshot().zoomLevel).toBe(1);

  // A same-origin sibling's zoom propagates inside the session; no event
  // reaches the hidden tab, so its mirror is stale until re-read.
  host.setLiveZoom(3);
  expect(tab.snapshot().zoomLevel).toBe(1);

  tab.syncZoom();
  expect(tab.snapshot().zoomLevel).toBe(3);
});

test("syncZoom on a closed tab reaches for nothing", () => {
  const { tab, host } = createTab();
  tab.close();
  const before = host.state.webContentsReads;
  tab.syncZoom();
  expect(host.state.webContentsReads).toBe(before);
});
