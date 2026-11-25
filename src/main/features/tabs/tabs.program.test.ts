import { describe, expect, test } from "vite-plus/test";
import { warn } from "../messages/messages.program";
import { Msg as VimMsg } from "../vim/vim.program";
import {
  CLOSED_TABS_KEPT,
  Cmd,
  init,
  layout,
  type Model,
  Msg,
  sessionTabs,
  strip,
  update,
} from "./tabs.program";

const M = Msg.cases;
const C = Cmd.cases;

function run(msgs: ReadonlyArray<Msg>, model: Model = init) {
  const cmds: Cmd[] = [];
  const follow: unknown[] = [];

  for (const msg of msgs) {
    const result = update(msg, model);

    model = result.model;
    cmds.push(...result.cmds);
    follow.push(...result.msgs);
  }

  return { model, cmds, follow };
}

const open = (url?: string, background = false, after?: number) =>
  M.TabOpenRequested.make({ url, after, background, origin: null, opener: null });

const content = { x: 0, y: 40, width: 800, height: 560 };
const windowRect = { x: 0, y: 0, width: 800, height: 600 };

const ready = run([
  M.ContentRectMeasured.make({ rect: content, radius: 11 }),
  M.WindowResized.make({ rect: windowRect }),
]).model;

describe("the collection", () => {
  test("a new tab is created, made active and focused; the homepage when no URL is given", () => {
    const { model, cmds } = run([open()], ready);

    expect(model.order).toEqual([1]);
    expect(model.activeId).toBe(1);
    expect(cmds).toContainEqual(C.CreateTabView.make({ id: 1, url: init.homepage }));
    expect(cmds).toContainEqual(C.FocusTab.make({ id: 1 }));
  });

  test("a background tab is created without taking over", () => {
    const { model } = run([open("https://a/"), open("https://b/", true)], ready);

    expect(model.activeId).toBe(1);
    expect(strip(model).tabs.map((tab) => tab.id)).toEqual([1, 2]);
  });

  test("a tab opened from a page goes next to its opener", () => {
    const { model } = run(
      [open("https://a/"), open("https://b/"), open("https://c/", true, 1)],
      ready,
    );

    expect(model.order).toEqual([1, 3, 2]);
  });

  test("a scheme the desktop owns is handed to the prompts, not loaded", () => {
    const { model, cmds } = run([open("bankid:///?x")], ready);

    expect(model.order).toEqual([]);
    expect(cmds).toEqual([
      C.RequestExternal.make({
        url: "bankid:///?x",
        scheme: "bankid",
        origin: null,
        selfInitiated: true,
        opener: null,
      }),
    ]);
  });

  test("a typed host:port is a host, not a scheme", () => {
    expect(run([open("localhost:3000")], ready).model.order).toEqual([1]);
  });

  test("closing the active tab hands over to its neighbour; the last one closes the window", () => {
    const three = run([open("https://a/"), open("https://b/"), open("https://c/")], ready).model;

    const closed = run(
      [M.TabActivated.make({ id: 2 }), M.TabCloseRequested.make({ id: 2 })],
      three,
    );

    expect(closed.model.activeId).toBe(3);
    expect(closed.cmds).toContainEqual(C.DestroyTabView.make({ id: 2 }));

    const last = run(
      [M.TabCloseRequested.make({ id: 1 }), M.TabCloseRequested.make({ id: 3 })],
      closed.model,
    );

    expect(last.cmds).toContainEqual(C.CloseWindow.make({}));
  });

  test("a tab that died on its own leaves without a view to destroy", () => {
    const { cmds } = run(
      [open("https://a/"), open("https://b/"), M.TabDied.make({ id: 1 })],
      ready,
    );

    expect(cmds).not.toContainEqual(C.DestroyTabView.make({ id: 1 }));
  });

  test("gt and gT wrap around", () => {
    const three = run([open("https://a/"), open("https://b/"), open("https://c/")], ready).model;

    expect(run([M.TabStepped.make({ offset: 1 })], three).model.activeId).toBe(1);
    expect(run([M.TabStepped.make({ offset: -1 })], three).model.activeId).toBe(2);
  });

  test("selecting by position counts from 1, and last is the last tab", () => {
    const three = run([open("https://a/"), open("https://b/"), open("https://c/")], ready).model;

    const select = (position: number | "last") =>
      run([M.TabSelected.make({ position })], three).model;

    expect(select(1).activeId).toBe(1);
    expect(select(2).activeId).toBe(2);
    expect(run([M.TabSelected.make({ position: "last" })], select(1)).model.activeId).toBe(3);
    expect(select(4)).toBe(three);
    expect(select(0)).toBe(three);
  });

  test("activating hands the keyboard back with the page's own editable state", () => {
    const two = run([open("https://a/"), open("https://b/")], ready).model;

    const typing = run(
      [M.TabEditableChanged.make({ id: 1, editable: true, focused: false })],
      two,
    ).model;

    expect(run([M.TabActivated.make({ id: 1 })], typing).follow).toContainEqual(
      VimMsg.cases.EditableChanged.make({ editable: true }),
    );
  });

  test("a background tab's focus change does not drag mode with it", () => {
    const two = run([open("https://a/"), open("https://b/")], ready).model;
    const changed = M.TabEditableChanged.make({ id: 1, editable: true, focused: true });

    expect(run([changed], two).follow).toEqual([]);
  });

  test("the saved session is every URL in order, and which one was active", () => {
    const { model } = run(
      [open("https://a/"), open("https://b/"), M.TabActivated.make({ id: 1 })],
      ready,
    );

    expect(sessionTabs(model)).toEqual({ urls: ["https://a/", "https://b/"], activeIndex: 0 });
    expect(sessionTabs(init)).toBeNull();
  });
});

describe("reopening a closed tab", () => {
  const three = run([open("https://a/"), open("https://b/"), open("https://c/")], ready).model;
  const close = (id: number) => M.TabCloseRequested.make({ id });
  const reopen = M.TabReopenRequested.make({});
  const urls = (model: Model) => strip(model).tabs.map((tab) => tab.url);

  const navigated = (model: Model, id: number, url: string) => {
    const state = { ...model.snapshots.get(id)!, url };

    return M.TabChanged.make({ id, state });
  };

  test("puts the URL back where it was and makes it active", () => {
    const { model, cmds } = run([close(2), reopen], three);

    expect(urls(model)).toEqual(["https://a/", "https://b/", "https://c/"]);
    expect(model.activeId).toBe(4);
    expect(cmds).toContainEqual(C.CreateTabView.make({ id: 4, url: "https://b/" }));
    expect(model.closed).toEqual([]);
  });

  test("an index past the end of a shorter strip appends", () => {
    const { model } = run([close(3), M.TabDied.make({ id: 1 }), reopen], three);

    expect(urls(model)).toEqual(["https://b/", "https://c/"]);
  });

  test("the newest close comes back first", () => {
    const once = run([close(3), close(1), reopen], three).model;

    expect(urls(once)).toEqual(["https://a/", "https://b/"]);
    expect(urls(run([reopen], once).model)).toEqual(["https://a/", "https://b/", "https://c/"]);
  });

  test("only the newest closes are kept", () => {
    const many = Array.from({ length: CLOSED_TABS_KEPT + 2 }, (_, i) => `https://${i}/`);
    const opened = run([...many.map((url) => open(url)), open("https://last/")], ready).model;
    const { model } = run(opened.order.slice(0, many.length).map(close), opened);

    expect(model.closed).toHaveLength(CLOSED_TABS_KEPT);
    expect(model.closed[0]!.url).toBe("https://2/");
  });

  test("a tab that died or was discarded is not offered back", () => {
    const { model } = run([M.TabDied.make({ id: 1 }), M.TabDiscarded.make({ id: 2 })], three);

    expect(model.closed).toEqual([]);
  });

  test("a tab with no URL is not remembered", () => {
    const { model } = run([navigated(three, 2, ""), close(2)], three);

    expect(model.closed).toEqual([]);
  });

  test("with nothing to reopen it says so and does nothing else", () => {
    const { model, cmds, follow } = run([reopen], three);

    expect(model).toBe(three);
    expect(cmds).toEqual([]);
    expect(follow).toEqual([warn("no closed tab to reopen")]);
  });

  test("a URL the desktop owns still goes to the prompts", () => {
    const { model, cmds } = run([navigated(three, 2, "bankid:///?x"), close(2), reopen], three);

    expect(model.order).toEqual([1, 3]);
    expect(cmds).toContainEqual(
      C.RequestExternal.make({
        url: "bankid:///?x",
        scheme: "bankid",
        origin: null,
        selfInitiated: true,
        opener: null,
      }),
    );
  });
});

describe("HTML fullscreen", () => {
  const one = run([open("https://a/"), open("https://b/", true)], ready).model;
  const claim = (id: number) => M.TabFullscreenRequested.make({ id, entering: true });
  const leave = C.SetWindowFullscreen.make({ fullscreen: false });

  test("the active tab's claim enters window fullscreen, and its view grows to the window", () => {
    const claimed = run([claim(1)], one);

    expect(claimed.cmds).toEqual([C.SetWindowFullscreen.make({ fullscreen: true })]);
    expect(layout(claimed.model).bounds).toEqual(windowRect);
  });

  test("a fullscreen page is square; the content frame's rounding comes back after", () => {
    const claimed = run([claim(1)], one).model;

    expect(layout(one).radius).toBe(11);
    expect(layout(claimed).radius).toBe(0);
    expect(layout(run([M.TabActivated.make({ id: 2 })], claimed).model).radius).toBe(11);
  });

  test("a background tab's claim is refused and told to give its state up", () => {
    expect(run([claim(2)], one).cmds).toEqual([C.CancelTabFullscreen.make({ id: 2 })]);
  });

  test("a window already fullscreen just takes the window bounds", () => {
    const full = run([M.WindowFullscreenChanged.make({ fullscreen: true })], one).model;

    expect(run([claim(1)], full).cmds).toEqual([]);
  });

  test("leaving, however it happened, restores the content rect", () => {
    const claimed = run(
      [claim(1), M.WindowFullscreenChanged.make({ fullscreen: true })],
      one,
    ).model;

    const left = run([M.WindowFullscreenChanged.make({ fullscreen: false })], claimed).model;

    expect(left.fullscreenId).toBeNull();
    expect(layout(left).bounds).toEqual(content);
  });

  test("switching away or closing the fullscreen tab leaves fullscreen; Escape does too", () => {
    const claimed = run([claim(1)], one).model;

    expect(run([M.TabActivated.make({ id: 2 })], claimed).cmds).toContainEqual(leave);
    expect(run([M.TabCloseRequested.make({ id: 1 })], claimed).cmds).toContainEqual(leave);
    expect(run([M.FullscreenLeaveRequested.make({})], claimed).cmds).toEqual([leave]);
    expect(run([M.FullscreenLeaveRequested.make({})], one).cmds).toEqual([]);
  });
});
