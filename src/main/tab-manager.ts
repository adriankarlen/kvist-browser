import { type BaseWindow, clipboard, type WebContents, WebContentsView } from "electron";
import { DEFAULT_SETTINGS, type Settings } from "../shared/config";
import type { BrowserState, FindResult, Rect, TabId } from "../shared/ipc";
import { composeContextMenuCss } from "./context-menu";
import { externalProtocolTarget } from "./external";
import type { PageContents } from "./page-host";
import { Tab, type TabCallbacks } from "./tab";
import type { KeyInput, KeySource } from "./vim";
import type { ZoomStore } from "./zoom";

interface CreateOptions {
  /** Open next to this tab rather than at the end, as a page-opened tab should. */
  after?: TabId;
  background?: boolean;
}

/**
 * The collection: which tabs exist, their order, which one is active, where
 * they sit, and the snapshot the chrome renders. Everything keyed to a single
 * page lives in `Tab`.
 */
export class TabManager {
  #window: BaseWindow;
  #emit: (state: BrowserState) => void;
  #onKey: (input: KeyInput, source: KeySource) => boolean = () => false;
  #onEditable: (editable: boolean) => void = () => {};
  #onFind: (result: FindResult | null) => void = () => {};
  #onInPageNavigation: (page: PageContents, url: string) => void = () => {};
  #onNavigated: (page: PageContents, url: string) => void = () => {};
  #onExternal: (url: string) => void = () => {};
  #pagePreload: string;
  #zoom: ZoomStore;
  #tabs = new Map<TabId, Tab>();
  /**
   * The views, kept beside the tabs: only the window needs the real thing.
   * Invariant: a view leaves the window exactly once, in `close`. A page that
   * dies on its own (e.g. `window.close()`) takes its webContents down before
   * anyone can act, and reaching through the view to unparent it afterwards
   * hangs the process — so the `died` path forgets the view while it stays
   * parented. That is a deliberate, bounded leak: the view is inert, and the
   * window owns it until the window itself closes.
   */
  #views = new Map<TabId, WebContentsView>();
  #order: TabId[] = [];
  #activeId: TabId | null = null;
  #contentRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  #nextId = 1;
  #homepage = DEFAULT_SETTINGS.homepage;
  #focusPage = DEFAULT_SETTINGS.tabFocusPage;
  /** tokens + menu styles + the user's config.css, composed for the page's menu. */
  #menuCss = "";

  constructor(
    window: BaseWindow,
    pagePreload: string,
    zoom: ZoomStore,
    emit: (state: BrowserState) => void,
  ) {
    this.#window = window;
    this.#pagePreload = pagePreload;
    this.#zoom = zoom;
    this.#emit = emit;
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
   * per window like the other observers; the URL has already been allowlisted
   * before it reaches here.
   */
  observeExternal(handler: (url: string) => void): void {
    this.#onExternal = handler;
  }

  /** The tab a webContents belongs to; the sender check for every tab channel. */
  tabFor(sender: WebContents): Tab | undefined {
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
   * Closes a tab that never committed a navigation. A download reached through
   * `target="_blank"` leaves one behind: the window-open handler cannot tell a
   * download URL from a page, so a tab is built for it and then nothing ever
   * loads. A download started from a loaded page has a committed entry, and
   * that tab is left alone.
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

  create(url: string = this.#homepage, options: CreateOptions = {}): void {
    // A scheme the desktop owns never becomes a tab: window.open and
    // target="_blank" arrive here through openRequest, so intercepting here —
    // rather than in the window-open handler — covers :tabnew and the context
    // menu's open-in-new-tab too, and no uncommitted tab is left behind.
    if (externalProtocolTarget(url) !== null) {
      this.#onExternal(url);
      return;
    }
    const tab = this.#adopt(url, options.after);
    this.#window.contentView.addChildView(this.#viewOf(tab));
    tab.setVisible(false);
    tab.navigate(url);
    if (options.background) this.#publish();
    else this.activate(tab.id);
  }

  close(id: TabId): void {
    const tab = this.#tabs.get(id);
    if (!tab) return;

    this.#window.contentView.removeChildView(this.#viewOf(tab));
    tab.close();
    this.#forget(id);
  }

  activate(id: TabId): void {
    const target = this.#tabs.get(id);
    if (!target) return;
    this.active?.hideContextMenu();
    this.#activeId = id;

    for (const tab of this.#tabs.values()) {
      tab.setVisible(tab.id === id);
    }

    target.setBounds(this.#contentRect);
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
    this.active?.setBounds(rect);
  }

  /** Registers a page as a tab; the caller navigates it and decides visibility. */
  #adopt(url: string, after?: TabId): Tab {
    const id = this.#nextId++;
    const view = new WebContentsView({ webPreferences: { preload: this.#pagePreload } });
    const tab = new Tab(id, view, this.#callbacks(id), this.#zoom, url);
    this.#views.set(id, view);

    this.#tabs.set(id, tab);
    const index = after === undefined ? -1 : this.#order.indexOf(after);
    if (index === -1) this.#order.push(id);
    else this.#order.splice(index + 1, 0, id);

    return tab;
  }

  /** The views, kept beside the tabs: only the window needs the real thing. */
  #viewOf(tab: Tab): WebContentsView {
    return this.#views.get(tab.id)!;
  }

  #callbacks(id: TabId): TabCallbacks {
    return {
      changed: () => this.#publish(),
      died: () => {
        if (!this.#window.isDestroyed()) this.#forget(id);
      },
      openRequest: (url, background) => {
        if (this.#tabs.has(id) && !this.#window.isDestroyed()) {
          this.create(url, { after: id, background });
        }
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
      copyText: (text) => clipboard.writeText(text),
      menuCss: () => this.#menuCss,
      externalRequest: (url) => this.#onExternal(url),
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
    this.#views.delete(id);
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

  #publish(): void {
    this.#emit({
      tabs: this.#order.map((id) => this.#tabs.get(id)!.snapshot()),
      activeId: this.#activeId,
    });
  }
}
