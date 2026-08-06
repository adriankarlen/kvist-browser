import { type BaseWindow, type WebContents, WebContentsView } from "electron";
import { DEFAULT_SETTINGS } from "../shared/config";
import type { BrowserState, Rect, TabId, TabState } from "../shared/ipc";
import type { KeyInput, KeySource } from "./vim";

interface Tab {
  id: TabId;
  view: WebContentsView;
  title: string;
  url: string;
  favicon: string | null;
  loading: boolean;
}

export class TabManager {
  #window: BaseWindow;
  #emit: (state: BrowserState) => void;
  #onKey: (input: KeyInput, source: KeySource) => boolean = () => false;
  #tabs = new Map<TabId, Tab>();
  #order: TabId[] = [];
  #activeId: TabId | null = null;
  #contentRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  #nextId = 1;
  homepage = DEFAULT_SETTINGS.homepage;

  constructor(window: BaseWindow, emit: (state: BrowserState) => void) {
    this.#window = window;
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

  focusActive(): void {
    this.#active()?.view.webContents.focus();
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

  create(url: string = this.homepage): void {
    const id = this.#nextId++;
    const view = new WebContentsView();
    const tab: Tab = { id, view, title: url, url, favicon: null, loading: true };

    this.#tabs.set(id, tab);
    this.#order.push(id);
    this.#window.contentView.addChildView(view);
    this.#track(tab);

    void view.webContents.loadURL(url);
    this.activate(id);
  }

  close(id: TabId): void {
    const tab = this.#tabs.get(id);
    if (!tab) return;

    const index = this.#order.indexOf(id);
    this.#tabs.delete(id);
    this.#order.splice(index, 1);
    this.#window.contentView.removeChildView(tab.view);
    tab.view.webContents.close();

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

  #active(): Tab | undefined {
    return this.#activeId === null ? undefined : this.#tabs.get(this.#activeId);
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

    const trackUrl = (): void => update({ url: webContents.getURL() });
    webContents.on("did-navigate", trackUrl);
    webContents.on("did-navigate-in-page", trackUrl);

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
