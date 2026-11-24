import { type BaseWindow, clipboard, type WebContents, WebContentsView } from "electron";
import type { Rect, TabId } from "../shared/schema/browser";
import { composeContextMenuCss } from "./context-menu";
import type { KeyInput, KeySource } from "./features/vim/vim.program";
import { type Layout, Msg } from "./features/tabs/tabs.program";
import { TabLayout } from "./tab-layout";
import type { PageSenders } from "./links";
import type { PageContents } from "./page-host";
import { Tab } from "./tab";
import type { ViewStack } from "./view-stack";
import type { ZoomStoreAccess } from "./zoom";

/** What the tab views report to, and ask of, the rest of the window. */
export interface TabViewHooks {
  dispatch(msg: Msg): void;
  key(input: KeyInput, source: KeySource): boolean;
  isBookmarked(url: string): boolean;
  connectPage(page: PageContents): PageSenders;
  navigated(page: PageContents, url: string): void;
  inPageNavigation(page: PageContents, url: string): void;
  external(
    url: string,
    scheme: string,
    origin: string | null,
    selfInitiated: boolean,
    contents: PageContents | null,
  ): void;
}

/**
 * The window's page views: the Electron side of the tabs feature. It makes
 * and destroys views when told, applies the layout the model derives, and
 * turns each page's events into Msgs. It decides nothing about the
 * collection.
 */
export class TabViews {
  readonly #window: BaseWindow;
  readonly #stack: ViewStack;
  readonly #preload: string;
  readonly #zoom: ZoomStoreAccess;
  readonly #hooks: TabViewHooks;
  readonly #tabs = new Map<TabId, Tab>();
  /**
   * The views, kept beside the tabs. A page that dies takes its webContents
   * first; unparenting afterwards hangs the process, so a dead tab's view is
   * forgotten while still parented: a bounded, inert leak.
   */
  readonly #views = new Map<TabId, WebContentsView>();
  #menuCss = "";
  readonly #layout = new TabLayout();

  constructor(
    window: BaseWindow,
    stack: ViewStack,
    preload: string,
    zoom: ZoomStoreAccess,
    hooks: TabViewHooks,
  ) {
    this.#window = window;
    this.#stack = stack;
    this.#preload = preload;
    this.#zoom = zoom;
    this.#hooks = hooks;

    const reportFullscreen = (fullscreen: boolean) => () =>
      hooks.dispatch(Msg.cases.WindowFullscreenChanged.make({ fullscreen }));

    window.on("enter-full-screen", reportFullscreen(true));
    window.on("leave-full-screen", reportFullscreen(false));
    window.on("resize", () =>
      hooks.dispatch(Msg.cases.WindowResized.make({ rect: this.#windowRect() })),
    );
    hooks.dispatch(Msg.cases.WindowResized.make({ rect: this.#windowRect() }));
  }

  /** The context menu is themed like the chrome: `themeCss` is the recipe plus config.css. */
  applyCss(themeCss: string): void {
    this.#menuCss = composeContextMenuCss(themeCss);
  }

  tab(id: TabId | null): Tab | undefined {
    return id === null ? undefined : this.#tabs.get(id);
  }

  tabFor(contents: PageContents): Tab | undefined {
    return [...this.#tabs.values()].find((tab) => tab.contents === contents);
  }

  /** Every open page and its URL, for a change that must reach pages already open. */
  forEachTab(fn: (contents: PageContents, url: string) => void): void {
    for (const tab of this.#tabs.values()) fn(tab.contents, tab.snapshot().url);
  }

  /** Republishes every snapshot, e.g. after a bookmark change. */
  refresh(): void {
    for (const tab of this.#tabs.values()) this.#changed(tab);
  }

  /** A download that opened a fresh tab leaves it empty, so it goes. */
  closeIfUncommitted(contents: WebContents): void {
    const tab = this.tabFor(contents);

    if (tab !== undefined && !tab.committed)
      this.#hooks.dispatch(Msg.cases.TabDiscarded.make({ id: tab.id }));
  }

  /** A page reporting focus on or off something typable. */
  setEditable(contents: PageContents, editable: boolean): void {
    const tab = this.tabFor(contents);

    if (tab === undefined) return;
    tab.setEditable(editable);
    this.#hooks.dispatch(
      Msg.cases.TabEditableChanged.make({ id: tab.id, editable, focused: tab.isFocused() }),
    );
  }

  create(id: TabId, url: string): void {
    const view = new WebContentsView({ webPreferences: { preload: this.#preload } });
    const tab = new Tab(id, view, this.#callbacks(id), this.#zoom, url);

    this.#views.set(id, view);
    this.#tabs.set(id, tab);
    this.#stack.addPage(view);
    this.#layout.place(id, tab);
    tab.navigate(url);
  }

  destroy(id: TabId): void {
    const tab = this.#tabs.get(id);
    const view = this.#views.get(id);

    if (tab === undefined || view === undefined) return;
    this.#stack.remove(view);
    tab.close();
    this.#forget(id);
  }

  focus(id: TabId): void {
    this.#tabs.get(id)?.focus();
  }

  syncZoom(id: TabId): void {
    this.#tabs.get(id)?.syncZoom();
  }

  hideContextMenu(id: TabId): void {
    this.#tabs.get(id)?.hideContextMenu();
  }

  cancelFullscreen(id: TabId): void {
    this.#tabs.get(id)?.cancelFullscreen();
  }

  /** A scheme the browser does not load itself, asked on behalf of `opener` (or nobody). */
  requestExternal(
    url: string,
    scheme: string,
    origin: string | null,
    selfInitiated: boolean,
    opener: TabId | null,
  ): void {
    this.#hooks.external(url, scheme, origin, selfInitiated, this.tab(opener)?.contents ?? null);
  }

  setWindowFullscreen(fullscreen: boolean): void {
    if (!this.#window.isDestroyed()) this.#window.setFullScreen(fullscreen);
  }

  isWindowFullscreen(): boolean {
    return !this.#window.isDestroyed() && this.#window.isFullScreen();
  }

  closeWindow(): void {
    if (!this.#window.isDestroyed()) this.#window.close();
  }

  reconcile(layout: Layout): void {
    this.#layout.reconcile(layout, this.#tabs);
  }

  #windowRect(): Rect {
    const { width, height } = this.#window.getContentBounds();

    return { x: 0, y: 0, width, height };
  }

  #changed(tab: Tab): void {
    this.#hooks.dispatch(Msg.cases.TabChanged.make({ id: tab.id, state: tab.snapshot() }));
  }

  #forget(id: TabId): void {
    this.#tabs.get(id)?.markDead();
    this.#tabs.delete(id);
    this.#views.delete(id);
  }

  #callbacks(id: TabId) {
    const hooks = this.#hooks;
    const tab = () => this.#tabs.get(id);

    return {
      changed: () => {
        const current = tab();

        if (current !== undefined) this.#changed(current);
      },
      died: () => {
        if (this.#window.isDestroyed()) return;
        this.#forget(id);
        hooks.dispatch(Msg.cases.TabDied.make({ id }));
      },
      openRequest: (url: string, background: boolean, origin: string | null) =>
        hooks.dispatch(
          Msg.cases.TabOpenRequested.make({ url, after: id, background, origin, opener: id }),
        ),
      found: (result: Parameters<typeof Msg.cases.TabFindChanged.make>[0]["result"]) =>
        hooks.dispatch(Msg.cases.TabFindChanged.make({ id, result })),
      editable: (editable: boolean) =>
        hooks.dispatch(Msg.cases.TabEditableChanged.make({ id, editable, focused: true })),
      inPageNavigation: (page: PageContents, url: string) => hooks.inPageNavigation(page, url),
      navigated: (page: PageContents, url: string) => hooks.navigated(page, url),
      key: (input: KeyInput, source: KeySource) => hooks.key(input, source),
      copyText: (text: string) => void clipboard.writeText(text),
      menuCss: () => this.#menuCss,
      isBookmarked: (url: string) => hooks.isBookmarked(url),
      connect: (page: PageContents) => hooks.connectPage(page),
      fullscreenChange: (entering: boolean) =>
        hooks.dispatch(Msg.cases.TabFullscreenRequested.make({ id, entering })),
      externalRequest: (
        url: string,
        scheme: string,
        origin: string | null,
        selfInitiated: boolean,
      ) => hooks.external(url, scheme, origin, selfInitiated, tab()?.contents ?? null),
    };
  }
}
