import type { WebContents } from "electron";
import { expect, test, vi } from "vite-plus/test";
import type { CompletionOverlayState, Rect } from "../shared/ipc";
import { CompletionOverlay } from "./completion-overlay";
import type { OverlayLease } from "./overlay-host";

const content = { width: 1000, height: 800 };
const anchor: Rect = { x: 20, y: 40, width: 960, height: 30 };

function state(...labels: string[]): CompletionOverlayState {
  return {
    candidates: labels.map((label) => ({ label, value: label })),
    index: 0,
    anchor,
    grow: "down",
  };
}

/**
 * One fake overlay view, plus the load event main waits on. `finishLoad`
 * stands in for `did-finish-load`, which is the only reason this seam has
 * `once` at all.
 */
function createLease() {
  const loadListeners: (() => void)[] = [];
  const sent: { channel: string; payload: unknown }[] = [];
  /** Everything that happened, in order, so a test can assert on sequence. */
  const log: string[] = [];
  let destroyed = false;

  const webContents = {
    once: (event: string, listener: () => void) => {
      if (event === "did-finish-load") loadListeners.push(listener);
      return webContents;
    },
    send: (channel: string, payload: unknown) => {
      sent.push({ channel, payload });
      log.push(`send ${channel}`);
    },
    isDestroyed: () => destroyed,
  };

  const lease = {
    host: {
      // SAFETY: a trimmed stand-in for the overlay's webContents — the
      // overlay only ever touches the three members defined above.
      webContents: webContents as unknown as OverlayLease["host"]["webContents"],
      setVisible: vi.fn((visible: boolean) => void log.push(`visible ${visible}`)),
      setBounds: vi.fn((bounds: Rect) => void log.push(`bounds ${bounds.width}x${bounds.height}`)),
    },
    release: vi.fn(),
  };

  return {
    lease,
    log,
    finishLoad: () => {
      for (const listener of loadListeners.splice(0)) listener();
    },
    destroy: () => {
      destroyed = true;
    },
    visible: () => lease.host.setVisible.mock.calls.at(-1)?.[0],
    bounds: () => lease.host.setBounds.mock.calls.at(-1)?.[0],
    payloads: (channel: string) =>
      sent.filter((message) => message.channel === channel).map((message) => message.payload),
  };
}

function setup(css = "") {
  const view = createLease();
  const open = vi.fn(() => view.lease);
  const overlay = new CompletionOverlay(
    open,
    () => content,
    () => css,
  );
  return { overlay, view, open };
}

test("no view is built until something is completed", () => {
  const { open } = setup();

  expect(open).not.toHaveBeenCalled();
});

test("the first completion builds the view once, and later ones reuse it", () => {
  const { overlay, view, open } = setup();

  overlay.show(state("a"));
  view.finishLoad();
  overlay.setHeight(60);
  overlay.hide();
  overlay.show(state("b"));

  expect(open).toHaveBeenCalledTimes(1);
});

test("a list that arrives before the view has loaded is sent once it has", () => {
  const { overlay, view } = setup();
  const first = state("a");

  overlay.show(first);
  expect(view.payloads("kvist:completion-state")).toEqual([]);

  view.finishLoad();

  expect(view.payloads("kvist:completion-state")).toEqual([first]);
});

test("an unmeasured list is shown at every pixel it could use, so it can lay out and answer", () => {
  const { overlay, view } = setup();

  overlay.show(state("a"));
  view.finishLoad();

  expect(view.visible()).toBe(true);
  expect(view.bounds()).toEqual({ x: 20, y: 70, width: 960, height: 730 });

  overlay.setHeight(60);

  expect(view.bounds()).toEqual({ x: 20, y: 70, width: 960, height: 60 });
});

test("the view is sized before the rows are sent, so there is a viewport to lay out in", () => {
  const { overlay, view } = setup();
  overlay.show(state("a"));

  view.finishLoad();

  const sized = view.log.indexOf("visible true");
  const rows = view.log.indexOf("send kvist:completion-state");
  expect(sized).toBeGreaterThanOrEqual(0);
  expect(sized).toBeLessThan(rows);
});

test("a height reported while the list is still pending is not thrown away", () => {
  const { overlay, view } = setup();

  overlay.show(state("a"));
  view.finishLoad();
  overlay.setHeight(60);
  overlay.hide();
  overlay.show(state("b"));

  expect(view.visible()).toBe(true);
  expect(view.bounds()).toEqual({ x: 20, y: 70, width: 960, height: 60 });
});

test("hiding takes the view off screen and leaves it nothing to cover", () => {
  const { overlay, view } = setup();

  overlay.show(state("a"));
  view.finishLoad();
  overlay.setHeight(60);
  overlay.hide();

  expect(view.visible()).toBe(false);
  expect(view.bounds()).toEqual({ x: 0, y: 0, width: 0, height: 0 });
});

test("hiding empties the list, so re-opening cannot flash the previous query's rows", () => {
  const { overlay, view } = setup();

  overlay.show(state("a"));
  view.finishLoad();
  overlay.hide();

  expect(view.payloads("kvist:completion-state").at(-1)).toEqual({
    candidates: [],
    index: -1,
    grow: "down",
    anchor: { x: 0, y: 0, width: 0, height: 0 },
  });
});

test("hiding before the view exists at all is not an error", () => {
  const { overlay, open } = setup();

  expect(() => overlay.hide()).not.toThrow();
  expect(open).not.toHaveBeenCalled();
});

test("a new height re-places a list that is already up", () => {
  const { overlay, view } = setup();

  overlay.show(state("a", "b"));
  view.finishLoad();
  overlay.setHeight(60);
  overlay.setHeight(120);

  expect(view.bounds()).toEqual({ x: 20, y: 70, width: 960, height: 120 });
});

test("the user's stylesheet reaches the overlay as soon as it can take it", () => {
  const { overlay, view } = setup(".kv-completion { color: red }");

  overlay.show(state("a"));
  view.finishLoad();

  expect(view.payloads("kvist:completion-css")).toEqual([".kv-completion { color: red }"]);
});

test("a retheme after the overlay is up is pushed to it", () => {
  let css = "";
  const view = createLease();
  const overlay = new CompletionOverlay(
    () => view.lease,
    () => content,
    () => css,
  );

  overlay.show(state("a"));
  view.finishLoad();
  css = ".kv-completion { color: blue }";
  overlay.applyCss();

  expect(view.payloads("kvist:completion-css").at(-1)).toBe(".kv-completion { color: blue }");
});

test("a retheme before the overlay exists is dropped rather than queued", () => {
  const { overlay, open } = setup(".kv-completion { color: red }");

  overlay.applyCss();

  expect(open).not.toHaveBeenCalled();
});

test("only the overlay's own webContents may talk back", () => {
  const { overlay, view } = setup();
  overlay.show(state("a"));

  // SAFETY: identity is all `owns` compares; this is the sender the fake lease handed over.
  expect(overlay.owns(view.lease.host.webContents as unknown as WebContents)).toBe(true);
  // SAFETY: identity is all `owns` compares; a bare object is a different sender.
  expect(overlay.owns({} as WebContents)).toBe(false);
});

test("nothing owns the overlay's channels before it exists", () => {
  const { overlay } = setup();

  // SAFETY: identity is all `owns` compares; a bare object is a different sender.
  expect(overlay.owns({} as WebContents)).toBe(false);
});

test("releasing hands the view back and forgets the list it was showing", () => {
  const { overlay, view, open } = setup();

  overlay.show(state("a"));
  view.finishLoad();
  overlay.setHeight(60);
  overlay.release();

  expect(view.lease.release).toHaveBeenCalledTimes(1);
  // SAFETY: identity is all `owns` compares; a released overlay owns nothing.
  expect(overlay.owns(view.lease.host.webContents as unknown as WebContents)).toBe(false);

  overlay.show(state("b"));
  expect(open).toHaveBeenCalledTimes(2);
});

test("a load that finishes after release does not resurrect the old view", () => {
  const { overlay, view } = setup();

  overlay.show(state("a"));
  overlay.release();
  view.finishLoad();

  expect(view.payloads("kvist:completion-state")).toEqual([]);
});

test("a destroyed webContents is not sent to", () => {
  const { overlay, view } = setup();

  overlay.show(state("a"));
  view.finishLoad();
  view.destroy();
  overlay.show(state("b"));

  expect(view.payloads("kvist:completion-state")).toEqual([state("a")]);
});
