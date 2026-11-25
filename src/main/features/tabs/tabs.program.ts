import { Schema } from "effect";
import { FindResult, Rect, TabId, TabState } from "../../../shared/schema/browser";
import type { BrowserState } from "../../../shared/schema/browser";
import { DEFAULT_SETTINGS } from "../../../shared/config";
import { next, type Next } from "../../../shared/tea/program";
import { externalProtocolTarget, looksLikeHostPort } from "../../external";
import { type Msg as MessagesMsg, warn } from "../messages/messages.program";
import { type Msg as VimMsg, Msg as VimMsgs } from "../vim/vim.program";

/** A tab the user closed, kept so it can be reopened where it was. */
export interface ClosedTab {
  readonly url: string;
  readonly index: number;
}

export const CLOSED_TABS_KEPT = 25;

/** Where `tab.select` goes: a 1-based position, or the last tab. */
export const TabPosition = Schema.Union([Schema.Int, Schema.Literal("last")]);

export type TabPosition = typeof TabPosition.Type;

/**
 * The collection: which tabs exist, their order, which is active, and where
 * page content goes. Each page's own life (its webContents, error pages,
 * zoom) is the tab view's; what it reports lands here as Msgs.
 */
export interface Model {
  readonly order: ReadonlyArray<TabId>;
  readonly activeId: TabId | null;
  readonly nextId: number;
  readonly snapshots: ReadonlyMap<TabId, TabState>;
  readonly editable: ReadonlyMap<TabId, boolean>;
  readonly finds: ReadonlyMap<TabId, FindResult | null>;
  readonly contentRect: Rect;
  readonly contentRadius: number;
  readonly windowRect: Rect;
  readonly windowFullscreen: boolean;
  /** The tab whose own HTML fullscreen request is honored, if any. */
  readonly fullscreenId: TabId | null;
  readonly homepage: string;
  /** Hand the keyboard back to the page after a tab action. */
  readonly focusPage: boolean;
  /** Newest last. */
  readonly closed: ReadonlyArray<ClosedTab>;
}

const NOWHERE: Rect = { x: 0, y: 0, width: 0, height: 0 };

export const init: Model = {
  order: [],
  activeId: null,
  nextId: 1,
  snapshots: new Map(),
  editable: new Map(),
  finds: new Map(),
  contentRect: NOWHERE,
  contentRadius: 0,
  windowRect: NOWHERE,
  windowFullscreen: false,
  fullscreenId: null,
  homepage: DEFAULT_SETTINGS.homepage,
  focusPage: DEFAULT_SETTINGS.tabFocusPage,
  closed: [],
};

export const Msg = Schema.TaggedUnion({
  /**
   * A tab to open. `opener` and `origin` name the page that asked
   * (`window.open`, "open in new tab"); saved rows, `:tabnew` and the
   * homepage have neither.
   */
  TabOpenRequested: {
    url: Schema.UndefinedOr(Schema.String),
    after: Schema.UndefinedOr(TabId),
    background: Schema.Boolean,
    origin: Schema.NullOr(Schema.String),
    opener: Schema.NullOr(TabId),
  },
  TabCloseRequested: { id: TabId },
  /** Closed for the user, not by them, so it is not offered for reopening. */
  TabDiscarded: { id: TabId },
  /** The page closed itself or its view is gone; there is nothing left to destroy. */
  TabDied: { id: TabId },
  TabReopenRequested: {},
  TabActivated: { id: TabId },
  TabStepped: { offset: Schema.Int },
  TabSelected: { position: TabPosition },
  TabChanged: { id: TabId, state: TabState },
  /** `focused`: whether the page holds the keyboard, so mode should follow it. */
  TabEditableChanged: { id: TabId, editable: Schema.Boolean, focused: Schema.Boolean },
  TabFindChanged: { id: TabId, result: Schema.NullOr(FindResult) },
  TabFullscreenRequested: { id: TabId, entering: Schema.Boolean },
  /** Escape while a page is fullscreen: what every other browser does. */
  FullscreenLeaveRequested: {},
  ContentRectMeasured: { rect: Rect, radius: Schema.Number },
  WindowResized: { rect: Rect },
  WindowFullscreenChanged: { fullscreen: Schema.Boolean },
  TabsConfigured: { homepage: Schema.String, focusPage: Schema.Boolean },
});

export type Msg = typeof Msg.Type;

export const Cmd = Schema.TaggedUnion({
  CreateTabView: { id: TabId, url: Schema.String },
  DestroyTabView: { id: TabId },
  FocusTab: { id: TabId },
  /** Re-read the zoom the session applied while the tab was hidden. */
  SyncTabZoom: { id: TabId },
  HideTabContextMenu: { id: TabId },
  /** Tell a refused fullscreen claim to give up the state it holds. */
  CancelTabFullscreen: { id: TabId },
  SetWindowFullscreen: { fullscreen: Schema.Boolean },
  CloseWindow: {},
  /** A scheme the browser does not load itself; whether it reaches the OS is the prompts' call. */
  RequestExternal: {
    url: Schema.String,
    scheme: Schema.String,
    origin: Schema.NullOr(Schema.String),
    selfInitiated: Schema.Boolean,
    opener: Schema.NullOr(TabId),
  },
});

export type Cmd = typeof Cmd.Type;

type Result = Next<Model, Msg | MessagesMsg | VimMsg, Cmd>;

const C = Cmd.cases;

function without<K, V>(map: ReadonlyMap<K, V>, key: K): Map<K, V> {
  const copy = new Map(map);

  copy.delete(key);

  return copy;
}

function activate(model: Model, id: TabId): Result {
  if (!model.snapshots.has(id)) return next(model);
  const cmds: Cmd[] = [];

  if (model.activeId !== null && model.activeId !== id) {
    cmds.push(C.HideTabContextMenu.make({ id: model.activeId }));
  }

  if (model.fullscreenId !== null && model.fullscreenId !== id) {
    cmds.push(C.SetWindowFullscreen.make({ fullscreen: false }));
  }

  cmds.push(C.SyncTabZoom.make({ id }));
  const msgs: Array<Msg | MessagesMsg | VimMsg> = [];

  if (model.focusPage) {
    cmds.push(C.FocusTab.make({ id }));
    msgs.push(VimMsgs.cases.EditableChanged.make({ editable: model.editable.get(id) ?? false }));
  }

  return next({ ...model, activeId: id }, cmds, msgs);
}

/** A tab leaves the collection; the active one hands over to its neighbour. */
function forget(model: Model, id: TabId, cmds: ReadonlyArray<Cmd>): Result {
  const index = model.order.indexOf(id);

  if (index === -1) return next(model, cmds);
  const order = model.order.filter((candidate) => candidate !== id);

  const rest: Model = {
    ...model,
    order,
    snapshots: without(model.snapshots, id),
    editable: without(model.editable, id),
    finds: without(model.finds, id),
    activeId: model.activeId === id ? null : model.activeId,
  };

  if (order.length === 0) return next(rest, [...cmds, C.CloseWindow.make({})]);

  if (model.activeId !== id) return next(rest, cmds);
  const handover = activate(rest, order[Math.min(index, order.length - 1)]!);

  return next(handover.model, [...cmds, ...handover.cmds], handover.msgs);
}

function remember(model: Model, id: TabId): Model {
  const url = model.snapshots.get(id)?.url ?? "";

  if (url === "") return model;
  const entry: ClosedTab = { url, index: model.order.indexOf(id) };

  return { ...model, closed: [...model.closed, entry].slice(-CLOSED_TABS_KEPT) };
}

function close(model: Model, id: TabId, reopenable: boolean): Result {
  if (!model.snapshots.has(id)) return next(model);
  const leaving = model.fullscreenId === id;
  const remembered = reopenable ? remember(model, id) : model;
  const closed = leaving ? { ...remembered, fullscreenId: null } : remembered;

  return forget(closed, id, [
    ...(leaving ? [C.SetWindowFullscreen.make({ fullscreen: false })] : []),
    C.DestroyTabView.make({ id }),
  ]);
}

/** `at` places the tab at that index in the strip, and wins over `msg.after`. */
function open(model: Model, msg: Extract<Msg, { _tag: "TabOpenRequested" }>, at?: number): Result {
  const url = msg.url ?? model.homepage;
  const scheme = externalProtocolTarget(url);
  const selfInitiated = msg.opener === null;

  // A typed `localhost:3000` parses as a scheme; it is a host and port.
  if (scheme !== null && !(selfInitiated && looksLikeHostPort(url))) {
    return next(model, [
      C.RequestExternal.make({
        url,
        scheme,
        origin: msg.origin,
        selfInitiated,
        opener: msg.opener,
      }),
    ]);
  }

  const id = model.nextId;
  const afterIndex = msg.after === undefined ? -1 : model.order.indexOf(msg.after);
  const index = at ?? (afterIndex === -1 ? model.order.length : afterIndex + 1);
  const order = [...model.order.slice(0, index), id, ...model.order.slice(index)];

  const placeholder: TabState = {
    id,
    title: url,
    url,
    favicon: null,
    loading: true,
    canGoBack: false,
    canGoForward: false,
    zoomLevel: 0,
    bookmarked: false,
  };

  const opened: Model = {
    ...model,
    order,
    nextId: id + 1,
    snapshots: new Map(model.snapshots).set(id, placeholder),
  };

  const create = C.CreateTabView.make({ id, url });

  if (msg.background) return next(opened, [create]);
  const activated = activate(opened, id);

  return next(activated.model, [create, ...activated.cmds], activated.msgs);
}

function fullscreen(model: Model, id: TabId, entering: boolean): Result {
  if (!entering) {
    return next(
      model,
      model.fullscreenId === id ? [C.SetWindowFullscreen.make({ fullscreen: false })] : [],
    );
  }

  if (model.fullscreenId === id) return next(model);

  // Only the active tab may take the screen, and only one at a time.
  if (model.fullscreenId !== null || id !== model.activeId) {
    return next(model, [C.CancelTabFullscreen.make({ id })]);
  }

  const claimed = { ...model, fullscreenId: id };

  return next(
    claimed,
    model.windowFullscreen ? [] : [C.SetWindowFullscreen.make({ fullscreen: true })],
  );
}

export function update(msg: Msg, model: Model): Result {
  return Msg.match(msg, {
    TabOpenRequested: (request) => open(model, request),
    TabCloseRequested: ({ id }) => close(model, id, true),
    TabDiscarded: ({ id }) => close(model, id, false),
    TabReopenRequested: () => {
      const last = model.closed.at(-1);

      if (last === undefined) return next(model, [], [warn("no closed tab to reopen")]);
      const popped = { ...model, closed: model.closed.slice(0, -1) };

      const request = Msg.cases.TabOpenRequested.make({
        url: last.url,
        after: undefined,
        background: false,
        origin: null,
        opener: null,
      });

      return open(popped, request, Math.min(last.index, popped.order.length));
    },
    TabDied: ({ id }) => forget(model, id, []),
    TabActivated: ({ id }) => activate(model, id),
    TabStepped: ({ offset }) => {
      if (model.activeId === null || model.order.length < 2) return next(model);
      const index = model.order.indexOf(model.activeId);
      const length = model.order.length;

      return activate(model, model.order[(index + offset + length) % length]!);
    },
    TabSelected: ({ position }) => {
      const id = model.order[position === "last" ? model.order.length - 1 : position - 1];

      return id === undefined ? next(model) : activate(model, id);
    },
    TabChanged: ({ id, state }) =>
      model.snapshots.has(id)
        ? next({ ...model, snapshots: new Map(model.snapshots).set(id, state) })
        : next(model),
    TabEditableChanged: ({ id, editable, focused }) => {
      if (!model.snapshots.has(id)) return next(model);
      const updated = { ...model, editable: new Map(model.editable).set(id, editable) };

      // A background tab losing focus to the chrome must not drag mode with it.
      return id === model.activeId && focused
        ? next(updated, [], [VimMsgs.cases.EditableChanged.make({ editable })])
        : next(updated);
    },
    TabFindChanged: ({ id, result }) =>
      model.snapshots.has(id)
        ? next({ ...model, finds: new Map(model.finds).set(id, result) })
        : next(model),
    TabFullscreenRequested: ({ id, entering }) => fullscreen(model, id, entering),
    FullscreenLeaveRequested: () =>
      next(
        model,
        model.fullscreenId === null ? [] : [C.SetWindowFullscreen.make({ fullscreen: false })],
      ),
    ContentRectMeasured: ({ rect, radius }) =>
      next({ ...model, contentRect: rect, contentRadius: radius }),
    WindowResized: ({ rect }) => next({ ...model, windowRect: rect }),
    // However fullscreen ended (the page, Escape, the window manager), this is where it resets.
    WindowFullscreenChanged: ({ fullscreen: on }) =>
      next({ ...model, windowFullscreen: on, fullscreenId: on ? model.fullscreenId : null }),
    TabsConfigured: ({ homepage, focusPage }) => next({ ...model, homepage, focusPage }),
  });
}

/** Where page content goes: one visible tab, at the content rect or the whole window. */
export interface Layout {
  readonly visible: TabId | null;
  readonly bounds: Rect;
  /** Corner rounding; a fullscreen page fills the window edge to edge, square. */
  readonly radius: number;
}

export function layout(model: Model): Layout {
  const fullscreen = model.fullscreenId !== null && model.fullscreenId === model.activeId;

  return {
    visible: model.activeId,
    bounds: fullscreen
      ? { x: 0, y: 0, width: model.windowRect.width, height: model.windowRect.height }
      : model.contentRect,
    radius: fullscreen ? 0 : model.contentRadius,
  };
}

/** What the tab strip renders. */
export const strip = (model: Model): BrowserState => ({
  tabs: model.order.flatMap((id) => {
    const snapshot = model.snapshots.get(id);

    return snapshot === undefined ? [] : [snapshot];
  }),
  activeId: model.activeId,
});

export const activeFind = (model: Model): FindResult | null =>
  model.activeId === null ? null : (model.finds.get(model.activeId) ?? null);

/** What a relaunch restores, or null when there are no tabs. */
export function sessionTabs(model: Model): { urls: string[]; activeIndex: number } | null {
  if (model.order.length === 0) return null;
  const urls = model.order.map((id) => model.snapshots.get(id)?.url ?? "");
  const activeIndex = model.activeId === null ? 0 : model.order.indexOf(model.activeId);

  return { urls, activeIndex };
}
