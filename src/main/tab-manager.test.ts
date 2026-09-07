import { EventEmitter } from "node:events";
import type { BaseWindow } from "electron";
import { beforeEach, expect, test, vi } from "vite-plus/test";
import type { Rect } from "../shared/ipc";
import { TabManager } from "./tab-manager";
import { ZoomStore } from "./zoom";

/**
 * One fake `WebContentsView` per tab, captured in creation order so a test
 * can reach the Nth tab's page without threading ids through the mock.
 * `vi.hoisted` because `vi.mock` below is itself hoisted above these
 * imports, and the factory has to close over the same array a test reads.
 */
const views = vi.hoisted(
  () =>
    // SAFETY: empty at import time; every element pushed by the mock below
    // matches this shape exactly.
    [] as {
      events: EventEmitter;
      setVisible: ReturnType<typeof vi.fn>;
      setBounds: ReturnType<typeof vi.fn>;
      executeJavaScript: ReturnType<typeof vi.fn>;
    }[],
);

vi.mock("electron", () => {
  class FakeWebContentsView {
    webContents: unknown;
    setVisible = vi.fn();
    setBounds = vi.fn();

    constructor() {
      const events = new EventEmitter();
      const executeJavaScript = vi.fn().mockResolvedValue(undefined);
      let zoomLevel = 0;
      let url = "";

      // SAFETY: a trimmed stand-in for `PageContents` \u2014 Tab only ever
      // touches the members defined here.
      this.webContents = {
        on: (event: string, listener: (...args: unknown[]) => void) => events.on(event, listener),
        once: (event: string, listener: (...args: unknown[]) => void) =>
          events.once(event, listener),
        removeListener: (event: string, listener: (...args: unknown[]) => void) =>
          events.removeListener(event, listener),
        send: () => {},
        loadURL: (next: string) => {
          url = next;
          return Promise.resolve();
        },
        getURL: () => url,
        reload: () => {},
        navigationHistory: {
          canGoBack: () => false,
          canGoForward: () => false,
          goBack: () => {},
          goForward: () => {},
        },
        findInPage: () => 0,
        stopFindInPage: () => {},
        focus: () => {},
        isFocused: () => false,
        sendInputEvent: () => {},
        cut: () => {},
        copy: () => {},
        paste: () => {},
        selectAll: () => {},
        inspectElement: () => {},
        close: () => events.emit("destroyed"),
        isDestroyed: () => false,
        forcefullyCrashRenderer: () => {},
        setWindowOpenHandler: () => {},
        isDevToolsOpened: () => false,
        openDevTools: () => {},
        closeDevTools: () => {},
        insertCSS: () => Promise.resolve(""),
        removeInsertedCSS: () => Promise.resolve(),
        setZoomLevel: (level: number) => {
          zoomLevel = level;
        },
        getZoomLevel: () => zoomLevel,
        executeJavaScript,
      };

      views.push({
        events,
        setVisible: this.setVisible,
        setBounds: this.setBounds,
        executeJavaScript,
      });
    }
  }

  return { WebContentsView: FakeWebContentsView, clipboard: { writeText: vi.fn() } };
});

/**
 * The in-memory adapter at the `BaseWindow` seam. `setFullScreen` mirrors
 * real Electron: a call that does not change the flag is a no-op and fires
 * no event \u2014 the one behavior the fullscreen bounds logic has to survive.
 */
function createFakeWindow(initial: Rect = { x: 0, y: 0, width: 1280, height: 800 }) {
  const events = new EventEmitter();
  let destroyed = false;
  let fullscreen = false;
  let bounds = { ...initial };
  let closeCount = 0;

  const base = {
    on: (event: string, listener: (...args: unknown[]) => void) => events.on(event, listener),
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    isDestroyed: () => destroyed,
    close: () => void closeCount++,
    setFullScreen: (flag: boolean) => {
      if (flag === fullscreen) return;
      fullscreen = flag;
      events.emit(flag ? "enter-full-screen" : "leave-full-screen");
    },
    isFullScreen: () => fullscreen,
    getContentBounds: () => ({ ...bounds }),
  };

  return {
    // SAFETY: a trimmed stand-in for `BaseWindow` — TabManager only ever
    // touches the members defined above.
    base: base as unknown as BaseWindow,
    isFullScreen: () => fullscreen,
    /** Simulates the window already being native-fullscreen through some
     * other path, with no `enter-full-screen` event to follow. */
    forceFullscreenNoEvent: () => {
      fullscreen = true;
    },
    resize: (next: Partial<Rect>) => {
      bounds = { ...bounds, ...next };
      events.emit("resize");
    },
    markDestroyed: () => {
      destroyed = true;
    },
    closeCount: () => closeCount,
  };
}

function setup(windowRect?: Rect) {
  const win = createFakeWindow(windowRect);
  const tabs = new TabManager(win.base, "preload.js", new ZoomStore(), vi.fn());
  return { win, tabs };
}

beforeEach(() => {
  views.length = 0;
});

test("a fullscreen claim from the active tab enters native fullscreen and grows its view to the window", () => {
  const { tabs, win } = setup();
  tabs.create("https://a.example");
  const view = views[0]!;

  view.events.emit("enter-html-full-screen");

  expect(win.isFullScreen()).toBe(true);
  expect(tabs.isHtmlFullscreen).toBe(true);
  expect(view.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1280, height: 800 });
});

test("a claim from a background tab is refused and told to give up its own fullscreen state", () => {
  const { tabs } = setup();
  tabs.create("https://a.example");
  tabs.create("https://b.example", { background: true });
  const background = views[1]!;

  background.events.emit("enter-html-full-screen");

  expect(tabs.isHtmlFullscreen).toBe(false);
  expect(background.executeJavaScript).toHaveBeenCalledWith("document.exitFullscreen()");
});

test("a second claim while one tab already owns fullscreen is refused the same way", () => {
  const { tabs } = setup();
  tabs.create("https://a.example");
  const owner = views[0]!;
  owner.events.emit("enter-html-full-screen");

  tabs.create("https://b.example", { background: true });
  const other = views[1]!;
  other.events.emit("enter-html-full-screen");

  expect(tabs.isHtmlFullscreen).toBe(true);
  expect(other.executeJavaScript).toHaveBeenCalledWith("document.exitFullscreen()");
});

test("a re-entrant claim from the tab that already owns fullscreen is left alone", () => {
  const { tabs } = setup();
  tabs.create("https://a.example");
  const view = views[0]!;
  view.events.emit("enter-html-full-screen");

  view.events.emit("enter-html-full-screen");

  expect(view.executeJavaScript).not.toHaveBeenCalled();
});

test("claiming fullscreen while the window is already fullscreen applies the window bounds directly", () => {
  const { tabs, win } = setup();
  win.forceFullscreenNoEvent();
  tabs.create("https://a.example");
  const view = views[0]!;

  view.events.emit("enter-html-full-screen");

  expect(tabs.isHtmlFullscreen).toBe(true);
  expect(view.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1280, height: 800 });
});

test("leaving fullscreen restores the tracked content rect, even one set while fullscreen", () => {
  const { tabs } = setup();
  tabs.setContentRect({ x: 0, y: 0, width: 300, height: 200 });
  tabs.create("https://a.example");
  const view = views[0]!;
  view.events.emit("enter-html-full-screen");
  view.setBounds.mockClear();

  // The content rect is still tracked while fullscreen gates it off, so a
  // chrome resize mid-fullscreen must not be lost by the time it ends.
  tabs.setContentRect({ x: 0, y: 0, width: 500, height: 400 });
  expect(view.setBounds).not.toHaveBeenCalled();

  view.events.emit("leave-html-full-screen");

  expect(tabs.isHtmlFullscreen).toBe(false);
  expect(view.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 500, height: 400 });
});

test("resizing the window while fullscreen re-applies the new window bounds", () => {
  const { tabs, win } = setup();
  tabs.create("https://a.example");
  const view = views[0]!;
  view.events.emit("enter-html-full-screen");
  view.setBounds.mockClear();

  win.resize({ width: 1920, height: 1080 });

  expect(view.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1920, height: 1080 });
});

test("switching tabs away from the one holding fullscreen leaves fullscreen and restores its bounds", () => {
  const { tabs, win } = setup();
  tabs.setContentRect({ x: 0, y: 0, width: 300, height: 200 });
  tabs.create("https://a.example");
  const owner = views[0]!;
  const otherId = tabs.create("https://b.example", { background: true })!;
  owner.events.emit("enter-html-full-screen");
  owner.setBounds.mockClear();

  tabs.activate(otherId);

  expect(win.isFullScreen()).toBe(false);
  expect(tabs.isHtmlFullscreen).toBe(false);
  expect(owner.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 300, height: 200 });
});

test("closing the tab that holds fullscreen leaves fullscreen behind", () => {
  const { tabs, win } = setup();
  const id = tabs.create("https://a.example")!;
  const view = views[0]!;
  view.events.emit("enter-html-full-screen");

  tabs.close(id);

  expect(win.isFullScreen()).toBe(false);
  expect(tabs.isHtmlFullscreen).toBe(false);
});

test("a fullscreen tab dying on its own leaves fullscreen once the next tab is activated", async () => {
  const { tabs, win } = setup();
  const id = tabs.create("https://a.example")!;
  const owner = views[0]!;
  tabs.create("https://b.example", { background: true });
  owner.events.emit("enter-html-full-screen");

  // Tab#track's own "destroyed" handler defers `died` to a microtask past
  // setImmediate, the same as a page's real `window.close()`.
  owner.events.emit("destroyed");
  await new Promise((resolve) => setImmediate(resolve));

  expect(win.isFullScreen()).toBe(false);
  expect(tabs.isHtmlFullscreen).toBe(false);
  // The dead tab's id must not linger as "the active tab" either.
  expect(tabs.active?.id).not.toBe(id);
});

test("Escape leaves fullscreen through the same public seam the mode machine uses", () => {
  const { tabs, win } = setup();
  tabs.create("https://a.example");
  const view = views[0]!;
  view.events.emit("enter-html-full-screen");

  tabs.leaveHtmlFullscreen();

  expect(win.isFullScreen()).toBe(false);
  expect(tabs.isHtmlFullscreen).toBe(false);
});
