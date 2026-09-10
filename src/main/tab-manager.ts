import { type BaseWindow, clipboard, type WebContents, WebContentsView } from "electron";
import { DEFAULT_SETTINGS, type Settings } from "../shared/config";
import type { BrowserState, FindResult, Rect, TabId } from "../shared/ipc";
import { composeContextMenuCss } from "./context-menu";
import { externalProtocolTarget, looksLikeHostPort } from "./external";
import type { PageContents } from "./page-host";
import { Tab, type TabCallbacks } from "./tab";
import type { ViewStack } from "./view-stack";
import type { KeyInput, KeySource } from "./vim";
import type { ZoomStore } from "./zoom";

interface CreateOptions {
  /** Open next to this tab rather than at the end, as a page-opened tab should. */
  after?: TabId;
  background?: boolean;
  /**
   * The page that asked for this tab, if any — `window.open`/'target=_blank'
   * and "open in new tab" name an opener; saved rows, `:tabnew`, and the
   * homepage do not. Read only when the URL turns out external-protocol.
   */
  origin?: string | null;
  /** The opener's webContents, paired with `origin` for the same reason. */
  contents?: PageContents | null;
}

/**
 * The collection: which tabs exist, their order, which one is active, where
 * they sit, and the snapshot the chrome renders. Everything keyed to a single
 * page lives in `Tab`.
 */
export class TabManager {
  #window: BaseWindow;
  #views: ViewStack;
  #emit: (state: BrowserState) => void;
  #onKey: (input: KeyInput, source: KeySource) => boolean = () => false;
  #onEditable: (editable: boolean) => void = () => {};
  #onFind: (result: FindResult | null) => void = () => {};
  #onInPageNavigation: (page: PageContents, url: string) => void = () => {};
  #onNavigated: (page: PageContents, url: string) => void = () => {};
  #onExternal: (
    url: string,
    scheme: string,
    origin: string | null,
    selfInitiated: boolean,
    contents: PageContents | null,
  ) => void = () => {};
  #pagePreload: string;
  #zoom: ZoomStore;
  #tabs = new Map<TabId, Tab>();
  /**
   * The views, kept beside the tabs. A view leaves the window once, in
   * `close`. A page that dies itself takes its webContents first;
   * unparenting afterwards hangs the process, so `died` forgets it while
   * parented — a bounded, inert leak.
   */
  #hosts = new Map<TabId, WebContentsView>();
  #order: TabId[] = [];
  #activeId: TabId | null = null;
  #contentRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  /**
   * The tab whose own HTML Fullscreen API request is currently honored, if
   * any.
   */
  #fullscreenId: TabId | null = null;
  #nextId = 1;
  #homepage = DEFAULT_SETTINGS.homepage;
  #focusPage = DEFAULT_SETTINGS.tabFocusPage;
  /** tokens + menu styles + the user's config.css, composed for the page's menu. */
  #menuCss = "";

  constructor(
    window: BaseWindow,
    views: ViewStack,
    pagePreload: string,
    zoom: ZoomStore,
    emit: (state: BrowserState) => void,
  ) {
    this.#window = window;
    this.#views = views;
    this.#pagePreload = pagePreload;
    this.#zoom = zoom;
    this.#emit = emit;

    // The single place fullscreen state resets, however the exit was
    // triggered — the page's own script, our Escape handling below, or the
    // window manager. `setFullScreen(false)` on a window that is HTML-
    // fullscreen exits both levels together, so this always fires last.
    this.#window.on("enter-full-screen", () => {
      if (this.#fullscreenId !== null)
        this.#tabs.get(this.#fullscreenId)?.setBounds(this.#windowRect());
    });
    this.#window.on("leave-full-screen", () => {
      const id = this.#fullscreenId;
      this.#fullscreenId = null;
      if (id !== null) this.#tabs.get(id)?.setBounds(this.#contentRect);
    });
    // A display change, or the user resizing an already-fullscreen window
    // (some window managers allow it), moves the window's own content
    // bounds without ever firing enter/leave-full-screen again.
    this.#window.on("resize", () => {
      if (this.#fullscreenId !== null)
        this.#tabs.get(this.#fullscreenId)?.setBounds(this.#windowRect());
    });
  }

  /**
   * Where a new tab starts, whether a tab action hands the keyboard back to
   * the page, and how the page's context menu is themed.
   */
  applySettings(config: {
    css: string;
    settings: Pick<Settings, "homepage" | "tabFocusPage">;
  }): void {
    this.#homepage = config.settings.homepage;
    this.#focusPage = config.settings.tabFocusPage;
    this.#menuCss = composeContextMenuCss(config.css);
  }

  /**
   * Every open tab's page and its current URL. For a change that has to reach
   * pages already open rather than wait for their next navigation — the
   * user's own styles, reapplied whenever the watched directory changes, are
   * the one case today.
   */
  forEachTab(fn: (contents: PageContents, url: string) => void): void {
    for (const tab of this.#tabs.values()) fn(tab.contents, tab.snapshot().url);
  }

  /** The tab every "do this to the page" verb belongs to, if there is one. */
  get active(): Tab | undefined {
    return this.#activeId === null ? undefined : this.#tabs.get(this.#activeId);
  }

  /** Every tab routes keys here before its page sees them. */
  interceptKeys(onKey: (input: KeyInput, source: KeySource) => boolean): void {
    this.#onKey = onKey;
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
   * A committed main-frame navigation, which is where anything keyed to the
   * URL rather than the document is applied — the user's styles, for one.
   */
  observeNavigation(handler: (page: PageContents, url: string) => void): void {
    this.#onNavigated = handler;
  }

  /**
   * History-API navigation, which changes the URL without reloading the frame.
   * Anything keyed to the URL rather than the document has to be reapplied.
   */
  observeInPageNavigation(handler: (page: PageContents, url: string) => void): void {
    this.#onInPageNavigation = handler;
  }

  /**
   * A URL the desktop, not a tab, should open — mailto: and kin. Wired once
   * per window like the other observers; the URL is already classified as a
   * scheme this browser does not load, but whether it opens is still
   * undecided.
   */
  observeExternal(
    handler: (
      url: string,
      scheme: string,
      origin: string | null,
      selfInitiated: boolean,
      contents: PageContents | null,
    ) => void,
  ): void {
    this.#onExternal = handler;
  }

  /** The tab a webContents belongs to; the sender check for every tab channel. */
  tabFor(sender: PageContents): Tab | undefined {
    return [...this.#tabs.values()].find((tab) => tab.contents === sender);
  }

  ownsTab(sender: WebContents): boolean {
    return this.tabFor(sender) !== undefined;
  }

  /** Doubles as the sender check for the editable channel. */
  setEditable(sender: WebContents, editable: boolean): void {
    const tab = this.tabFor(sender);
    if (!tab) return;

    tab.setEditable(editable);
    // A background tab losing focus to the chrome must not drag mode with it.
    if (tab.id === this.#activeId && tab.isFocused()) this.#onEditable(editable);
  }

  /**
   * Closes a tab that never committed a navigation: a download through
   * `target="_blank"` leaves one behind, since the window-open handler
   * cannot tell a download URL from a page. A download from a loaded page
   * has a committed entry and stays.
   */
  closeIfUncommitted(sender: WebContents): void {
    const tab = this.tabFor(sender);
    if (tab && !tab.committed) this.close(tab.id);
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

  create(url: string = this.#homepage, options: CreateOptions = {}): TabId | null {
    // A scheme the desktop owns never becomes a tab: window.open and
    // target="_blank" arrive here through openRequest, so intercepting here —
    // rather than in the window-open handler — covers :tabnew and the context
    // menu's open-in-new-tab too, and no uncommitted tab is left behind.
    // Returning null lets session restore map its saved active index to a
    // real id without a special case for external-protocol URLs.
    const scheme = externalProtocolTarget(url);
    if (scheme !== null) {
      // No opener means this came from :tabnew, :open, the default homepage,
      // or a saved session row — the same ambiguous, typed-not-authored
      // input navigate() guards against, so a bare "localhost:3000" is not
      // mistaken for a scheme here either.
      const selfInitiated = options.contents === undefined;
      if (!(selfInitiated && looksLikeHostPort(url))) {
        this.#onExternal(
          url,
          scheme,
          options.origin ?? null,
          selfInitiated,
          options.contents ?? null,
        );
        return null;
      }
    }
    const tab = this.#adopt(url, options.after);
    this.#views.addPage(this.#viewOf(tab));
    tab.setVisible(false);
    tab.navigate(url);
    if (options.background) this.#publish();
    else this.activate(tab.id);
    return tab.id;
  }

  /**
   * The ordered URLs and active position, so session-save need not ask each
   * tab. Null when every tab is closed — the close handler then clears the
   * saved row rather than resurrecting tabs the user is done with.
   */
  urlsForSession(): { urls: string[]; activeIndex: number } | null {
    if (this.#order.length === 0) return null;
    const urls = this.#order.map((id) => this.#tabs.get(id)!.snapshot().url);
    const activeIndex = this.#activeId === null ? 0 : this.#order.indexOf(this.#activeId);
    return { urls, activeIndex };
  }

  close(id: TabId): void {
    const tab = this.#tabs.get(id);
    if (!tab) return;

    // Closing the tab that owns fullscreen must not leave the window stuck
    // fullscreen over a view that is about to be removed.
    if (this.#fullscreenId === id) {
      this.#fullscreenId = null;
      if (!this.#window.isDestroyed()) this.#window.setFullScreen(false);
    }
    this.#views.remove(this.#viewOf(tab));
    tab.close();
    this.#forget(id);
  }

  activate(id: TabId): void {
    const target = this.#tabs.get(id);
    if (!target) return;
    this.active?.hideContextMenu();
    // Switching tabs exits fullscreen, matching every other browser — the
    // `leave-full-screen` listener restores the outgoing tab's bounds.
    if (this.#fullscreenId !== null && this.#fullscreenId !== id && !this.#window.isDestroyed()) {
      this.#window.setFullScreen(false);
    }
    this.#activeId = id;

    for (const tab of this.#tabs.values()) {
      tab.setVisible(tab.id === id);
    }

    // Reactivating the tab that already owns fullscreen (a redundant
    // activateTab, say) must not shrink it back to the content rect — only
    // an actual switch to a different tab leaves fullscreen, handled above.
    target.setBounds(this.#fullscreenId === id ? this.#windowRect() : this.#contentRect);
    // Same-origin zoom propagates across tabs inside the session, so a hidden
    // tab's level can have moved with nothing for it to observe. Refresh the
    // mirror before the publish below, or the strip shows — and the next
    // zi/zo steps from — a stale level.
    target.syncZoom();
    // Hiding the view that had focus drops it back on the chrome, so without
    // this the page stops receiving keys after the first tab switch.
    if (this.#focusPage) {
      target.focus();
      // Mode follows the tab you land on, not the one you left.
      this.#onEditable(target.editable);
    }
    // Matches are per tab, so the chrome has to be told whose it is showing.
    this.#onFind(target.findResult);
    this.#publish();
  }

  setContentRect(rect: Rect): void {
    this.#contentRect = rect;
    // While a tab holds fullscreen, its view keeps the whole window's
    // bounds — the content rect resumes governing it once fullscreen ends.
    if (this.#fullscreenId === null) this.active?.setBounds(rect);
  }

  /** Whether some tab currently owns the window's native fullscreen. */
  get isHtmlFullscreen(): boolean {
    return this.#fullscreenId !== null;
  }

  /**
   * Leaves fullscreen regardless of which tab owns it. The one caller today
   * is Escape, which every other browser lets leave fullscreen before doing
   * anything else.
   */
  leaveHtmlFullscreen(): void {
    if (this.#fullscreenId === null || this.#window.isDestroyed()) return;
    this.#window.setFullScreen(false);
  }

  /** Registers a page as a tab; the caller navigates it and decides visibility. */
  #adopt(url: string, after?: TabId): Tab {
    const id = this.#nextId++;
    const view = new WebContentsView({ webPreferences: { preload: this.#pagePreload } });
    const tab = new Tab(id, view, this.#callbacks(id), this.#zoom, url);
    this.#hosts.set(id, view);

    this.#tabs.set(id, tab);
    const index = after === undefined ? -1 : this.#order.indexOf(after);
    if (index === -1) this.#order.push(id);
    else this.#order.splice(index + 1, 0, id);

    return tab;
  }

  /** The views, kept beside the tabs: only the window needs the real thing. */
  #viewOf(tab: Tab): WebContentsView {
    return this.#hosts.get(tab.id)!;
  }

  /** The whole window's client area, in the coordinate frame `setBounds` takes. */
  #windowRect(): Rect {
    const { width, height } = this.#window.getContentBounds();
    return { x: 0, y: 0, width, height };
  }

  #callbacks(id: TabId): TabCallbacks {
    return {
      changed: () => this.#publish(),
      died: () => {
        if (!this.#window.isDestroyed()) this.#forget(id);
      },
      openRequest: (url, background, origin) => {
        const opener = this.#tabs.get(id);
        if (!opener || this.#window.isDestroyed()) return;
        this.create(url, {
          after: id,
          background,
          origin,
          contents: opener.contents,
        });
      },
      // A background tab's matches are its own business until it is activated.
      found: (result) => {
        if (id === this.#activeId) this.#onFind(result);
      },
      editable: (editable) => {
        if (id === this.#activeId) this.#onEditable(editable);
      },
      inPageNavigation: (page, url) => this.#onInPageNavigation(page, url),
      navigated: (page, url) => this.#onNavigated(page, url),
      key: (input, source) => this.#onKey(input, source),
      copyText: (text) => {
        void clipboard.writeText(text);
      },
      menuCss: () => this.#menuCss,
      fullscreenChange: (entering) => {
        if (entering) {
          // A duplicate or re-entrant claim from the tab that already owns
          // fullscreen changes nothing — cancelling it here would call
          // `document.exitFullscreen()` on a page that is genuinely and
          // correctly fullscreen right now.
          if (this.#fullscreenId === id) return;
          // Only the active, visible tab may claim fullscreen; a hidden
          // document has no business holding it, and a second claim while
          // another tab already owns it is refused. A refusal has to say so
          // back to the page — otherwise its own `fullscreenElement` state
          // lies forever, since no `leave-html-full-screen` is coming to
          // correct it.
          if (this.#fullscreenId !== null || id !== this.#activeId || this.#window.isDestroyed()) {
            this.#tabs.get(id)?.cancelFullscreen();
            return;
          }
          this.#fullscreenId = id;
          // Already fullscreen — a second HTML fullscreen request racing the
          // first's own exit, say — is a no-op on the window, so the
          // `enter-full-screen` event this otherwise waits for never fires.
          // Apply the bounds directly rather than trust an event that isn't
          // coming.
          if (this.#window.isFullScreen()) this.#tabs.get(id)?.setBounds(this.#windowRect());
          else this.#window.setFullScreen(true);
        } else if (this.#fullscreenId === id && !this.#window.isDestroyed()) {
          this.#window.setFullScreen(false);
        }
      },
      externalRequest: (url, scheme, origin, selfInitiated) =>
        this.#onExternal(url, scheme, origin, selfInitiated, this.#tabs.get(id)?.contents ?? null),
    };
  }

  /**
   * Drops a tab without touching its page, which `close` cannot do: once a
   * webContents is destroyed, reaching through the view for it hangs the
   * process, so a view that died on its own is left parented and forgotten.
   */
  #forget(id: TabId): void {
    const index = this.#order.indexOf(id);
    if (index === -1) return;

    this.#tabs.get(id)?.markDead();
    this.#tabs.delete(id);
    this.#hosts.delete(id);
    this.#order.splice(index, 1);

    if (this.#order.length === 0) {
      this.#window.close();
      return;
    }

    if (this.#activeId !== id) {
      this.#publish();
      return;
    }

    this.activate(this.#order[Math.min(index, this.#order.length - 1)]!);
  }

  #publish(): void {
    this.#emit({
      tabs: this.#order.map((id) => this.#tabs.get(id)!.snapshot()),
      activeId: this.#activeId,
    });
  }
}
