import {
  type BaseWindow,
  clipboard,
  type ContextMenuParams,
  type WebContents,
  WebContentsView,
} from "electron";
import { DEFAULT_SETTINGS } from "../shared/config";
import {
  type BrowserState,
  CHANNELS,
  type ContextMenuState,
  type FindResult,
  type Point,
  type Rect,
  type ScrollCommand,
  type TabId,
  type TabState,
} from "../shared/ipc";
import { buildContextMenuItems } from "./context-menu";
import { ERR_ABORTED, errorPageTarget, formatErrorPageUrl } from "./error-page";
import type { KeyInput, KeySource } from "./vim";

interface CreateOptions {
  /** Open next to this tab rather than at the end, as a page-opened tab should. */
  after?: TabId;
  background?: boolean;
}

interface Tab {
  id: TabId;
  view: WebContentsView;
  title: string;
  url: string;
  favicon: string | null;
  loading: boolean;
  /** Whether this tab currently has something typable focused. */
  editable: boolean;
  /** The live find query, or "" when nothing is being searched for. */
  find: string;
  findResult: FindResult | null;
  /** The request id of the in-flight search, so a stale result can be told apart from the current one. */
  findRequestId: number | null;
  /** The URL whose failure an error page is already showing, so a duplicate report is not rendered twice. */
  failedUrl: string | null;
}

export class TabManager {
  #window: BaseWindow;
  #emit: (state: BrowserState) => void;
  #onKey: (input: KeyInput, source: KeySource) => boolean = () => false;
  #onEditable: (editable: boolean) => void = () => {};
  #onFind: (result: FindResult | null) => void = () => {};
  #onInPageNavigation: (contents: WebContents, url: string) => void = () => {};
  #pagePreload: string;
  #tabs = new Map<TabId, Tab>();
  #order: TabId[] = [];
  #activeId: TabId | null = null;
  #contentRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  #nextId = 1;
  /** The menu that is up, if any — the params are needed again at pick time. */
  #contextMenu: { tab: Tab; params: ContextMenuParams } | null = null;
  homepage = DEFAULT_SETTINGS.homepage;
  focusPage = DEFAULT_SETTINGS.tabFocusPage;
  /** tokens + menu styles + the user's config.css, composed in index.ts. */
  contextMenuCss = "";

  constructor(window: BaseWindow, pagePreload: string, emit: (state: BrowserState) => void) {
    this.#window = window;
    this.#pagePreload = pagePreload;
    this.#emit = emit;
  }

  /** Every tab routes keys here before its page sees them. */
  interceptKeys(onKey: (input: KeyInput, source: KeySource) => boolean): void {
    this.#onKey = onKey;
  }

  /**
   * The chrome needs the same treatment as a page: it is a separate
   * webContents, so without this every key pressed while the chrome holds
   * focus is invisible to the mode machine.
   */
  interceptChromeKeys(webContents: WebContents): void {
    this.#bindKeys(webContents, "chrome");
  }

  /** Tabs report focus landing on a text field, so normal mode can step aside. */
  observeEditable(onEditable: (editable: boolean) => void): void {
    this.#onEditable = onEditable;
  }

  /** Match counts for the active tab, so the chrome can show them. */
  observeFind(onFind: (result: FindResult | null) => void): void {
    this.#onFind = onFind;
  }

  /**
   * History-API navigation, which changes the URL without reloading the frame.
   * Anything keyed to the URL rather than the document has to be reapplied.
   */
  observeInPageNavigation(handler: (contents: WebContents, url: string) => void): void {
    this.#onInPageNavigation = handler;
  }

  /**
   * Doubles as the sender check for the editable channel: a webContents that
   * owns no tab is not one of ours and is ignored.
   */
  setEditable(sender: WebContents, editable: boolean): void {
    const tab = [...this.#tabs.values()].find((candidate) => candidate.view.webContents === sender);
    if (!tab) return;

    tab.editable = editable;
    // A background tab losing focus to the chrome must not drag mode with it.
    if (tab.id === this.#activeId && sender.isFocused()) this.#onEditable(editable);
  }

  focusActive(): void {
    this.#active()?.view.webContents.focus();
  }

  blurActive(): void {
    this.#send(CHANNELS.pageBlur);
  }

  scrollActive(command: ScrollCommand): void {
    this.#send(CHANNELS.pageScroll, command);
  }

  /**
   * Searches from the top, which is what an incremental prompt wants — every
   * keystroke is a new query and should land on the first match again.
   */
  find(query: string): void {
    const tab = this.#active();
    if (!tab) return;
    // findInPage rejects an empty string, and an emptied prompt means "stop".
    if (query === "") {
      this.stopFind();
      return;
    }

    tab.find = query;
    // `findNext: false` is the documented default, but passing it explicitly
    // makes Electron 43 run the search and never emit `found-in-page` — so a
    // new search has to be spelled as the absence of the option.
    tab.findRequestId = tab.view.webContents.findInPage(query, { forward: true });
  }

  /** `n` / `N`, which continue the query the prompt left behind. */
  findNext(forward: boolean): void {
    const tab = this.#active();
    if (!tab || tab.find === "") return;
    tab.findRequestId = tab.view.webContents.findInPage(tab.find, { forward, findNext: true });
  }

  stopFind(): void {
    const tab = this.#active();
    if (!tab || tab.find === "") return;
    tab.find = "";
    tab.findRequestId = null;
    tab.view.webContents.stopFindInPage("clearSelection");
    this.#reportFind(tab, null);
  }

  showHints(): void {
    this.#send(CHANNELS.hintsShow);
  }

  hintKey(key: string): void {
    this.#send(CHANNELS.hintsKey, key);
  }

  hideHints(): void {
    this.#send(CHANNELS.hintsHide);
  }

  /**
   * A real click, rather than the page scripting one on itself. Injected input
   * carries user activation, which is what keeps the resulting history entry
   * navigable.
   */
  clickActive({ x, y }: Point): void {
    const contents = this.#active()?.view.webContents;
    if (!contents) return;

    const event = { x, y, button: "left", clickCount: 1 } as const;
    contents.sendInputEvent({ ...event, type: "mouseDown" });
    contents.sendInputEvent({ ...event, type: "mouseUp" });
  }

  /** Doubles as the sender check on the hint channel, like `setEditable`. */
  ownsTab(sender: WebContents): boolean {
    return [...this.#tabs.values()].some((tab) => tab.view.webContents === sender);
  }

  /**
   * Closes a tab that never committed a navigation. A download reached through
   * `target="_blank"` leaves one behind: the window-open handler cannot tell a
   * download URL from a page, so a tab is built for it and then nothing ever
   * loads. A download started from a loaded page has a committed entry, and
   * that tab is left alone.
   */
  closeIfUncommitted(sender: WebContents): void {
    const tab = [...this.#tabs.values()].find((candidate) => candidate.view.webContents === sender);
    if (tab && tab.view.webContents.getURL() === "") this.close(tab.id);
  }

  closeActive(): void {
    if (this.#activeId !== null) this.close(this.#activeId);
  }

  step(offset: number): void {
    if (this.#activeId === null || this.#order.length < 2) return;
    const index = this.#order.indexOf(this.#activeId);
    const next = (index + offset + this.#order.length) % this.#order.length;
    this.activate(this.#order[next]!);
  }

  create(url: string = this.homepage, options: CreateOptions = {}): void {
    const tab = this.#adopt(url, options.after);
    this.#attach(tab);
    void tab.view.webContents.loadURL(url);
    if (options.background) this.#publish();
    else this.activate(tab.id);
  }

  close(id: TabId): void {
    const tab = this.#tabs.get(id);
    if (!tab) return;

    if (this.#contextMenu?.tab.id === id) this.#contextMenu = null;
    this.#window.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
    this.#forget(id);
  }

  /**
   * Drops a tab without touching its view, which `close` cannot do: once a
   * webContents is destroyed, reaching through the view for it hangs the
   * process, so a view that died on its own is left parented and forgotten.
   */
  #forget(id: TabId): void {
    const index = this.#order.indexOf(id);
    if (index === -1) return;

    this.#tabs.delete(id);
    this.#order.splice(index, 1);

    if (this.#order.length === 0) {
      this.#window.close();
      return;
    }

    if (this.#activeId === id) {
      this.activate(this.#order[Math.min(index, this.#order.length - 1)]!);
    } else {
      this.#publish();
    }
  }

  activate(id: TabId): void {
    if (!this.#tabs.has(id)) return;
    this.#hideContextMenu();
    this.#activeId = id;

    for (const tab of this.#tabs.values()) {
      tab.view.setVisible(tab.id === id);
    }

    this.#applyContentRect();
    // Hiding the view that had focus drops it back on the chrome, so without
    // this the page stops receiving keys after the first tab switch.
    if (this.focusPage) {
      this.focusActive();
      // Mode follows the tab you land on, not the one you left.
      this.#onEditable(this.#tabs.get(id)!.editable);
    }
    // Matches are per tab, so the chrome has to be told whose it is showing.
    this.#onFind(this.#tabs.get(id)!.findResult);
    this.#publish();
  }

  setContentRect(rect: Rect): void {
    this.#contentRect = rect;
    this.#applyContentRect();
  }

  /**
   * Answers the tab's pick — an item id, or null when the menu was dismissed
   * without one. The stash is dropped either way; a late pick after the tab
   * closed finds no tab and does nothing.
   */
  pickContextMenu(id: string | null): void {
    const menu = this.#contextMenu;
    this.#contextMenu = null;
    if (menu === null || id === null || !this.#tabs.has(menu.tab.id)) return;

    const { webContents } = menu.tab.view;
    const { params } = menu;
    const actions: Record<string, () => void> = {
      "nav.back": () => webContents.navigationHistory.goBack(),
      "nav.forward": () => webContents.navigationHistory.goForward(),
      "nav.reload": () => webContents.reload(),
      // Background, next to its opener — the same answer window.open gets.
      "link.open-in-new-tab": () =>
        this.create(params.linkURL, { after: menu.tab.id, background: true }),
      "link.copy": () => clipboard.writeText(params.linkURL),
      "image.copy": () => clipboard.writeText(params.srcURL),
      "edit.cut": () => webContents.cut(),
      "edit.copy": () => webContents.copy(),
      "edit.paste": () => webContents.paste(),
      "edit.select-all": () => webContents.selectAll(),
      "selection.copy": () => webContents.copy(),
      inspect: () => webContents.inspectElement(params.x, params.y),
    };
    actions[id]?.();
  }

  /**
   * Opens the menu in the tab that was right-clicked. Only the visible tab
   * can be, so this is always the active one. The menu renders in the page
   * itself — the tab's view paints over the chrome, so chrome HTML could
   * never overlap it — and the styling travels with the payload.
   */
  #openContextMenu(tab: Tab, params: ContextMenuParams): void {
    this.#contextMenu = { tab, params };
    const { navigationHistory } = tab.view.webContents;
    const state: ContextMenuState = {
      x: params.x,
      y: params.y,
      items: buildContextMenuItems(params, {
        canGoBack: navigationHistory.canGoBack(),
        canGoForward: navigationHistory.canGoForward(),
      }),
      css: this.contextMenuCss,
    };
    tab.view.webContents.send(CHANNELS.contextMenu, state);
  }

  /** Hides the menu in its tab and drops the stash; a no-op when none is up. */
  #hideContextMenu(): void {
    const menu = this.#contextMenu;
    this.#contextMenu = null;
    if (menu === null || !this.#tabs.has(menu.tab.id)) return;
    menu.tab.view.webContents.send(CHANNELS.contextMenu, null);
  }

  navigate(url: string): void {
    void this.#active()?.view.webContents.loadURL(url);
  }

  goBack(): void {
    this.#active()?.view.webContents.navigationHistory.goBack();
  }

  goForward(): void {
    this.#active()?.view.webContents.navigationHistory.goForward();
  }

  reload(): void {
    this.#active()?.view.webContents.reload();
  }

  toggleDevTools(): void {
    const contents = this.#active()?.view.webContents;
    if (!contents) return;
    if (contents.isDevToolsOpened()) contents.closeDevTools();
    else contents.openDevTools({ mode: "bottom" });
  }

  /** Registers a view as a tab; the caller navigates it and decides visibility. */
  #adopt(url: string, after?: TabId): Tab {
    const id = this.#nextId++;
    const view = new WebContentsView({ webPreferences: { preload: this.#pagePreload } });
    const tab: Tab = {
      id,
      view,
      title: url,
      url,
      favicon: null,
      loading: true,
      editable: false,
      find: "",
      findResult: null,
      findRequestId: null,
      failedUrl: null,
    };

    this.#tabs.set(id, tab);
    const index = after === undefined ? -1 : this.#order.indexOf(after);
    if (index === -1) this.#order.push(id);
    else this.#order.splice(index + 1, 0, id);

    this.#track(tab);
    return tab;
  }

  #attach(tab: Tab): void {
    tab.view.setVisible(false);
    this.#window.contentView.addChildView(tab.view);
  }

  #active(): Tab | undefined {
    return this.#activeId === null ? undefined : this.#tabs.get(this.#activeId);
  }

  #send(channel: string, payload?: unknown): void {
    this.#active()?.view.webContents.send(channel, payload);
  }

  #applyContentRect(): void {
    this.#active()?.view.setBounds(this.#contentRect);
  }

  /** A background tab's matches are its own business until it is activated. */
  #reportFind(tab: Tab, result: FindResult | null): void {
    tab.findResult = result;
    if (tab.id === this.#activeId) this.#onFind(result);
  }

  #track(tab: Tab): void {
    const { webContents } = tab.view;

    const update = (patch: Partial<Tab>): void => {
      Object.assign(tab, patch);
      this.#publish();
    };

    webContents.on("page-title-updated", (_event, title) => update({ title }));
    webContents.on("did-start-loading", () => update({ loading: true }));
    webContents.on("did-stop-loading", () => update({ loading: false }));
    webContents.on("page-favicon-updated", (_event, favicons) => {
      update({ favicon: favicons[0] ?? null });
    });

    // `window.open` and `target="_blank"`, answered with a tab of our own.
    // Handing Chromium a `WebContentsView`'s webContents through `createWindow`
    // would keep the opener relationship, but it deadlocks the process in
    // Electron 43 — so the request is denied and the tab opened separately,
    // which is why the page gets null back from `window.open`.
    webContents.setWindowOpenHandler((details) => {
      // Denying is answered synchronously; the tab is not built until Chromium
      // has left window creation.
      setImmediate(() => {
        if (!this.#tabs.has(tab.id) || this.#window.isDestroyed()) return;
        this.create(details.url, {
          after: tab.id,
          background: details.disposition === "background-tab",
        });
      });
      return { action: "deny" };
    });

    // A page calling `window.close()` takes its own webContents down, leaving
    // the tab holding a dead view. Unwinding inside Chromium's teardown hangs
    // it, so this waits; a tab closed through `close` is already forgotten by
    // the time this runs, and `#forget` ignores it.
    webContents.on("destroyed", () => {
      setImmediate(() => {
        if (!this.#window.isDestroyed()) this.#forget(tab.id);
      });
    });

    webContents.on("found-in-page", (_event, result) => {
      // A search Chromium re-ran for a document we have already given up on,
      // or a stale request superseded by a newer one — both report late.
      if (tab.find === "" || result.requestId !== tab.findRequestId) return;
      this.#reportFind(tab, {
        query: tab.find,
        matches: result.matches,
        active: result.activeMatchOrdinal,
      });
    });

    webContents.on("context-menu", (_event, params) => this.#openContextMenu(tab, params));

    const failLoad = (
      code: number,
      description: string,
      url: string,
      isMainFrame: boolean,
    ): void => {
      // Aborted loads are ordinary navigation, and a sub-frame's failure is
      // the page's own problem — neither is the tab's to explain.
      if (code === ERR_ABORTED || !isMainFrame) return;
      // An error page failing must not stack another error page on top.
      if (errorPageTarget(url) !== null) return;
      // did-fail-load and did-fail-provisional-load can both fire for one
      // failure; only the first may render the page.
      if (tab.failedUrl === url) return;

      tab.failedUrl = url;
      void webContents.loadURL(formatErrorPageUrl({ code, description, url }));
    };
    webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      failLoad(code, description, url, isMainFrame);
    });
    webContents.on("did-fail-provisional-load", (_event, code, description, url, isMainFrame) => {
      failLoad(code, description, url, isMainFrame);
    });

    // A fresh main-frame navigation ends the previous failure's dedupe, so a
    // retry of the same URL renders a new error page rather than a blank
    // view. Our own error page load must not clear it: the second of the two
    // fail events above may not have fired yet, and it must stay deduped.
    webContents.on("did-start-navigation", (_event, url, _isInPlace, isMainFrame) => {
      if (isMainFrame && errorPageTarget(url) === null) tab.failedUrl = null;
    });

    // A dead renderer is not a destroyed webContents: the view survives, and
    // loading the error page revives it in a new process.
    webContents.on("render-process-gone", (_event, details) => {
      if (details.reason === "clean-exit") return;
      // A crashed error page must not stack another error page on top, same
      // as in failLoad above.
      if (errorPageTarget(webContents.getURL()) !== null) return;
      tab.failedUrl = tab.url;
      void webContents.loadURL(
        formatErrorPageUrl({ code: null, description: details.reason, url: tab.url }),
      );
    });

    // A hung page cannot load its own error page — the event may also repeat
    // while the renderer stays stuck — so it is crashed from outside and the
    // render-process-gone path above renders the failure.
    webContents.on("unresponsive", () => {
      if (!webContents.isDestroyed()) webContents.forcefullyCrashRenderer();
    });

    // The tab strip shows the URL that failed, not the error page's own
    // address — the failure is what the user was navigating to.
    const trackUrl = (): void => {
      const current = webContents.getURL();
      update({ url: errorPageTarget(current)?.url ?? current });
    };
    webContents.on("did-navigate", () => {
      // The menu's document is gone, and with it the menu; only the stash
      // needs forgetting. No hide is sent — the new page never showed one.
      if (this.#contextMenu?.tab.id === tab.id) this.#contextMenu = null;
      // The matches belonged to a document that is gone. Chromium keeps the
      // session and re-runs it against the new one, so the search has to be
      // ended rather than merely forgotten.
      if (tab.find !== "") {
        tab.find = "";
        tab.findRequestId = null;
        webContents.stopFindInPage("clearSelection");
        this.#reportFind(tab, null);
      }
      trackUrl();
    });
    webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      trackUrl();
      if (isMainFrame) this.#onInPageNavigation(webContents, url);
    });

    this.#bindKeys(webContents, "page");
  }

  #bindKeys(webContents: WebContents, source: KeySource): void {
    webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const consumed = this.#onKey(
        {
          key: input.key,
          control: input.control,
          alt: input.alt,
          meta: input.meta,
        },
        source,
      );
      if (consumed) event.preventDefault();
    });
  }

  #publish(): void {
    const tabs: TabState[] = this.#order.map((id) => {
      const tab = this.#tabs.get(id)!;
      const { navigationHistory } = tab.view.webContents;
      return {
        id: tab.id,
        title: tab.title,
        url: tab.url,
        favicon: tab.favicon,
        loading: tab.loading,
        canGoBack: navigationHistory.canGoBack(),
        canGoForward: navigationHistory.canGoForward(),
      };
    });

    this.#emit({ tabs, activeId: this.#activeId });
  }
}
