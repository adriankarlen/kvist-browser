import { type BaseWindow, type WebContents, WebContentsView } from "electron";
import { DEFAULT_SETTINGS } from "../shared/config";
import {
  type BrowserState,
  CHANNELS,
  type Point,
  type Rect,
  type ScrollCommand,
  type TabId,
  type TabState,
} from "../shared/ipc";
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
}

export class TabManager {
  #window: BaseWindow;
  #emit: (state: BrowserState) => void;
  #onKey: (input: KeyInput, source: KeySource) => boolean = () => false;
  #onEditable: (editable: boolean) => void = () => {};
  #onInPageNavigation: (contents: WebContents, url: string) => void = () => {};
  #pagePreload: string;
  #tabs = new Map<TabId, Tab>();
  #order: TabId[] = [];
  #activeId: TabId | null = null;
  #contentRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  #nextId = 1;
  homepage = DEFAULT_SETTINGS.homepage;
  focusPage = DEFAULT_SETTINGS.tabFocusPage;

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
    this.#publish();
  }

  setContentRect(rect: Rect): void {
    this.#contentRect = rect;
    this.#applyContentRect();
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
    const tab: Tab = { id, view, title: url, url, favicon: null, loading: true, editable: false };

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

    const trackUrl = (): void => update({ url: webContents.getURL() });
    webContents.on("did-navigate", trackUrl);
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
