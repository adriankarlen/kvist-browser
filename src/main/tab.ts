import type { ContextMenuParams } from "electron";
import {
  type ContextMenuState,
  type FindResult,
  type Point,
  type Rect,
  type ScrollCommand,
  senders,
  type Senders,
  type TabId,
  type TabState,
  toPage,
} from "../shared/ipc";
import { buildContextMenuItems } from "./context-menu";
import { ERR_ABORTED, errorPageTarget, formatErrorPageUrl } from "./error-page";
import { interceptKeys } from "./keys";
import type { PageContents, PageHost } from "./page-host";
import type { KeyInput, KeySource } from "./vim";

/**
 * What a Tab reports upward. A Tab never names the collection it belongs to:
 * a sibling tab, the mode machine and the snapshot are all somebody else's
 * business, so they arrive here as plain callbacks.
 */
export interface TabCallbacks {
  /** Something the snapshot shows has moved. */
  changed(): void;
  /** The page took its own webContents down, e.g. `window.close()`. */
  died(): void;
  /** `window.open` or `target="_blank"`, which wants a tab next to this one. */
  openRequest(url: string, background: boolean): void;
  found(result: FindResult | null): void;
  editable(editable: boolean): void;
  /** History-API navigation; anything keyed to the URL has to be reapplied. */
  inPageNavigation(page: PageContents, url: string): void;
  /** Synchronous, because `before-input-event` is: true swallows the key. */
  key(input: KeyInput, source: KeySource): boolean;
  /** The system clipboard, which is the environment's rather than the page's. */
  copyText(text: string): void;
  /** tokens + menu styles + the user's config.css, as they stand right now. */
  menuCss(): string;
}

/**
 * One page and everything keyed to it: what the strip shows, the find session,
 * the error-page state and the context menu. Closed, it goes inert — reaching
 * through a view for a destroyed webContents hangs the process, so a dead Tab
 * answers every verb with nothing rather than defending each call site.
 */
export class Tab {
  readonly id: TabId;
  #host: PageHost;
  /**
   * Captured while the page is alive. Reaching through the view for a
   * destroyed webContents hangs the process, so the reference is taken once
   * and every use of it is guarded by `#closed` instead.
   */
  #page: PageContents;
  /** The page's half of the channel tables, bound to this tab's webContents. */
  #toPage: Senders<typeof toPage>;
  #on: TabCallbacks;
  #closed = false;

  #title: string;
  #url: string;
  #favicon: string | null = null;
  #loading = true;
  /** Whether this tab currently has something typable focused. */
  #editable = false;
  /** The live find query, or "" when nothing is being searched for. */
  #find = "";
  #findResult: FindResult | null = null;
  /** The request id of the in-flight search, so a stale result can be told apart. */
  #findRequestId: number | null = null;
  /** The URL whose failure an error page already shows, so it is not rendered twice. */
  #failedUrl: string | null = null;
  /** The menu that is up, if any — the params are needed again at pick time. */
  #menu: ContextMenuParams | null = null;

  constructor(id: TabId, host: PageHost, callbacks: TabCallbacks, url: string) {
    this.id = id;
    this.#host = host;
    this.#page = host.webContents;
    this.#toPage = senders(toPage, (channel, payload) => {
      if (!this.#closed) this.#page.send(channel, payload);
    });
    this.#on = callbacks;
    this.#title = url;
    this.#url = url;
    this.#track();
  }

  /** Identity for the sender checks; a webContents is its own answer. */
  get contents(): PageContents {
    return this.#page;
  }

  get editable(): boolean {
    return this.#editable;
  }

  get findResult(): FindResult | null {
    return this.#findResult;
  }

  /** True once a navigation has committed; an untouched tab has no URL at all. */
  get committed(): boolean {
    return !this.#closed && this.#page.getURL() !== "";
  }

  snapshot(): TabState {
    const strip = {
      id: this.id,
      title: this.#title,
      url: this.#url,
      favicon: this.#favicon,
      loading: this.#loading,
    };
    // Read live rather than tracked: history depth changes without an event.
    // A closed page has no history left to ask.
    if (this.#closed) return { ...strip, canGoBack: false, canGoForward: false };
    const { navigationHistory } = this.#page;
    return {
      ...strip,
      canGoBack: navigationHistory.canGoBack(),
      canGoForward: navigationHistory.canGoForward(),
    };
  }

  setVisible(visible: boolean): void {
    if (!this.#closed) this.#host.setVisible(visible);
  }

  setBounds(rect: Rect): void {
    if (!this.#closed) this.#host.setBounds(rect);
  }

  focus(): void {
    if (!this.#closed) this.#page.focus();
  }

  /** Whether the keyboard is on this page rather than on the chrome. */
  isFocused(): boolean {
    return !this.#closed && this.#page.isFocused();
  }

  blur(): void {
    this.#toPage.pageBlur();
  }

  scroll(command: ScrollCommand): void {
    this.#toPage.pageScroll(command);
  }

  showHints(): void {
    this.#toPage.hintsShow();
  }

  hintKey(key: string): void {
    this.#toPage.hintsKey(key);
  }

  hideHints(): void {
    this.#toPage.hintsHide();
  }

  /**
   * A real click, rather than the page scripting one on itself. Injected input
   * carries user activation, which is what keeps the resulting history entry
   * navigable.
   */
  click({ x, y }: Point): void {
    if (this.#closed) return;
    const event = { x, y, button: "left", clickCount: 1 } as const;
    this.#page.sendInputEvent({ ...event, type: "mouseDown" });
    this.#page.sendInputEvent({ ...event, type: "mouseUp" });
  }

  navigate(url: string): void {
    if (!this.#closed) void this.#page.loadURL(url);
  }

  goBack(): void {
    if (!this.#closed) this.#page.navigationHistory.goBack();
  }

  goForward(): void {
    if (!this.#closed) this.#page.navigationHistory.goForward();
  }

  reload(): void {
    if (!this.#closed) this.#page.reload();
  }

  toggleDevTools(): void {
    if (this.#closed) return;
    const webContents = this.#page;
    if (webContents.isDevToolsOpened()) webContents.closeDevTools();
    else webContents.openDevTools({ mode: "bottom" });
  }

  /** A tab reporting focus landing on, or leaving, something typable. */
  setEditable(editable: boolean): void {
    this.#editable = editable;
  }

  /**
   * Searches from the top, which is what an incremental prompt wants — every
   * keystroke is a new query and should land on the first match again.
   */
  find(query: string): void {
    if (this.#closed) return;
    // findInPage rejects an empty string, and an emptied prompt means "stop".
    if (query === "") {
      this.stopFind();
      return;
    }

    this.#find = query;
    // `findNext: false` is the documented default but never emits
    // `found-in-page`; passing `forward: true` and leaving `findNext` off
    // searches the same way and does report. A new search is therefore the
    // absence of the option.
    this.#findRequestId = this.#page.findInPage(query, { forward: true });
  }

  /** `n` / `N`, which continue the query the prompt left behind. */
  findNext(forward: boolean): void {
    if (this.#closed || this.#find === "") return;
    this.#findRequestId = this.#page.findInPage(this.#find, {
      forward,
      findNext: true,
    });
  }

  stopFind(): void {
    if (this.#closed || this.#find === "") return;
    this.#endFind();
    this.#report(null);
  }

  /**
   * Answers this tab's pick — an item id, or null when the menu was dismissed
   * without one. The stash is dropped either way.
   */
  pickContextMenu(id: string | null): void {
    const params = this.#menu;
    this.#menu = null;
    if (params === null || id === null || this.#closed) return;

    const webContents = this.#page;
    const actions: Record<string, () => void> = {
      "nav.back": () => webContents.navigationHistory.goBack(),
      "nav.forward": () => webContents.navigationHistory.goForward(),
      "nav.reload": () => webContents.reload(),
      // Background, next to its opener — the same answer window.open gets.
      "link.open-in-new-tab": () => this.#on.openRequest(params.linkURL, true),
      "link.copy": () => this.#on.copyText(params.linkURL),
      "image.copy": () => this.#on.copyText(params.srcURL),
      "edit.cut": () => webContents.cut(),
      "edit.copy": () => webContents.copy(),
      "edit.paste": () => webContents.paste(),
      "edit.select-all": () => webContents.selectAll(),
      "selection.copy": () => webContents.copy(),
      inspect: () => webContents.inspectElement(params.x, params.y),
    };
    actions[id]?.();
  }

  /** Hides the menu in the page and drops the stash; a no-op when none is up. */
  hideContextMenu(): void {
    if (this.#menu === null) return;
    this.#menu = null;
    this.#toPage.contextMenu(null);
  }

  /**
   * Closes the page. The view stays parented; the collection owns the window,
   * and a Tab that has been closed is inert either way.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#menu = null;
    this.#page.close();
  }

  /** Marks a Tab whose page died on its own as inert, without touching it. */
  markDead(): void {
    this.#closed = true;
    this.#menu = null;
  }

  #update(patch: {
    title?: string;
    url?: string;
    favicon?: string | null;
    loading?: boolean;
  }): void {
    if (patch.title !== undefined) this.#title = patch.title;
    if (patch.url !== undefined) this.#url = patch.url;
    if (patch.favicon !== undefined) this.#favicon = patch.favicon;
    if (patch.loading !== undefined) this.#loading = patch.loading;
    this.#on.changed();
  }

  #report(result: FindResult | null): void {
    this.#findResult = result;
    this.#on.found(result);
  }

  /** Ends the search Chromium is holding, rather than merely forgetting it. */
  #endFind(): void {
    this.#find = "";
    this.#findRequestId = null;
    this.#page.stopFindInPage("clearSelection");
  }

  #track(): void {
    const webContents = this.#page;

    webContents.on("page-title-updated", (_event, title) => this.#update({ title }));
    webContents.on("did-start-loading", () => this.#update({ loading: true }));
    webContents.on("did-stop-loading", () => this.#update({ loading: false }));
    webContents.on("page-favicon-updated", (_event, favicons) => {
      this.#update({ favicon: favicons[0] ?? null });
    });

    // `window.open` and `target="_blank"`, answered with a tab of our own.
    // Handing Chromium a `WebContentsView`'s webContents through `createWindow`
    // would keep the opener relationship, but it deadlocks the process — so
    // we deny, which is also why a `target="_blank"` POST loses its
    // `postBody`: the request never reaches the new tab.
    webContents.setWindowOpenHandler((details) => {
      // Denying is answered synchronously; the tab is not built until Chromium
      // has left window creation.
      setImmediate(() => {
        if (!this.#closed)
          this.#on.openRequest(details.url, details.disposition === "background-tab");
      });
      return { action: "deny" };
    });

    // A page calling `window.close()` takes its own webContents down, leaving
    // this holding a dead view. Unwinding inside Chromium's teardown hangs it,
    // so this waits.
    webContents.on("destroyed", () => {
      const wasClosed = this.#closed;
      this.markDead();
      if (!wasClosed) setImmediate(() => this.#on.died());
    });

    webContents.on("found-in-page", (_event, result) => {
      // A search Chromium re-ran for a document we have already given up on,
      // or a stale request superseded by a newer one — both report late.
      if (this.#find === "" || result.requestId !== this.#findRequestId) return;
      this.#report({
        query: this.#find,
        matches: result.matches,
        active: result.activeMatchOrdinal,
      });
    });

    webContents.on("context-menu", (_event, params) => this.#openContextMenu(params));

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
      if (this.#failedUrl === url) return;

      this.#failedUrl = url;
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
      if (isMainFrame && errorPageTarget(url) === null) this.#failedUrl = null;
    });

    // A dead renderer is not a destroyed webContents: the view survives, and
    // loading the error page revives it in a new process.
    webContents.on("render-process-gone", (_event, details) => {
      if (details.reason === "clean-exit") return;
      // A crashed error page must not stack another error page on top, same
      // as in failLoad above.
      if (errorPageTarget(webContents.getURL()) !== null) return;
      this.#failedUrl = this.#url;
      void webContents.loadURL(
        formatErrorPageUrl({ code: null, description: details.reason, url: this.#url }),
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
      this.#update({ url: errorPageTarget(current)?.url ?? current });
    };
    webContents.on("did-navigate", () => {
      // The menu's document is gone, and with it the menu; only the stash
      // needs forgetting. No hide is sent — the new page never showed one.
      this.#menu = null;
      // The matches belonged to a document that is gone. Chromium keeps the
      // session and re-runs it against the new one, so the search has to be
      // ended rather than merely forgotten.
      if (this.#find !== "") {
        this.#endFind();
        this.#report(null);
      }
      trackUrl();
    });
    webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      trackUrl();
      if (isMainFrame) this.#on.inPageNavigation(webContents, url);
    });

    interceptKeys(webContents, "page", (input, source) => this.#on.key(input, source));
  }

  /**
   * Opens the menu in the page itself: the tab's view paints over the chrome,
   * so chrome HTML could never overlap it, and the styling travels with the
   * payload.
   */
  #openContextMenu(params: ContextMenuParams): void {
    if (this.#closed) return;
    this.#menu = params;
    const { navigationHistory } = this.#page;
    const state: ContextMenuState = {
      x: params.x,
      y: params.y,
      items: buildContextMenuItems(params, {
        canGoBack: navigationHistory.canGoBack(),
        canGoForward: navigationHistory.canGoForward(),
      }),
      css: this.#on.menuCss(),
    };
    this.#toPage.contextMenu(state);
  }
}
