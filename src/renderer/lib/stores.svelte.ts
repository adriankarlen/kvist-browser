import { untrack } from "svelte";
import { ChromeIntent } from "../../shared/rpc/chrome";
import type { Rect, TabId, WindowControl } from "../../shared/schema/browser";
import type { CompletionCandidate, CompletionOverlayState } from "../../shared/schema/completion";
import { app, claimCompletion, queries } from "../app/store.svelte";
import { Msg as BookmarksMsg } from "../features/bookmarks/bookmarks.program";
import {
  Msg as DownloadsMsg,
  panelVisible,
  transferring,
} from "../features/downloads/downloads.program";
import { Msg as LinkMsg } from "../features/link/link.program";
import { activeTab, Msg as MainMsg } from "../features/main/main.program";
import { regions } from "../features/ui/ui.program";
import {
  findShown,
  Msg as LayoutMsg,
  omniboxShown,
  type StatusLine,
  statusLine,
  tabStrip,
  type TabStripState,
} from "../features/layout/layout.program";
import type { ElementId, Layout, Placement, Region } from "../../shared/layout";
import { keyTitle } from "../../shared/key-title";

/**
 * What components read and the Msgs they dispatch, named the way the
 * components use them. Every getter is a projection of `app.model`; every
 * verb dispatches. Nothing here holds state of its own.
 */
const I = ChromeIntent.cases;
const ask = (intent: ChromeIntent): void => app.dispatch(LinkMsg.cases.IntentSent.make({ intent }));

export const browser = {
  get tabs() {
    return app.model.main.browser.tabs;
  },
  get activeId() {
    return app.model.main.browser.activeId;
  },
  get active() {
    return activeTab(app.model.main);
  },
};

const MOD = navigator.userAgent.includes("Macintosh") ? "Cmd" : "Ctrl";

export const vim = {
  get mode() {
    return app.model.main.mode;
  },
  /** False under `[input] mode = "standard"`, where modes are never shown. */
  get enabled() {
    return app.model.ui.settings.inputMode === "vim";
  },
  /** Hands control back to the page; main moves focus off the chrome. */
  toNormal: () => ask(I.ModeRequested.make({ mode: "normal" })),
};

export const keys = {
  /** `text` with the live keys of `commands`, e.g. "Bookmark this page (B)". */
  title: (text: string, ...commands: string[]): string =>
    keyTitle(text, app.model.ui.settings.keymap, commands, MOD),
};

export const messages = {
  get current() {
    return app.model.main.message;
  },
};

export const prompts = {
  get current() {
    return app.model.main.prompt;
  },
  answer: (allow: boolean) => app.dispatch(MainMsg.cases.PromptButtonClicked.make({ allow })),
};

export const find = {
  get result() {
    return app.model.main.findResult;
  },
  get query() {
    return app.model.main.findResult?.query ?? "";
  },
  get active() {
    return app.model.main.findResult !== null;
  },
  run: (query: string) => ask(I.FindRequested.make({ query })),
  stop: () => app.dispatch(MainMsg.cases.FindStopped.make({})),
};

export const downloads = {
  get list() {
    return app.model.downloads.list;
  },
  get active() {
    return transferring(app.model.downloads);
  },
  get visible() {
    return panelVisible(app.model.downloads, app.model.ui.settings.layout.downloads.visible);
  },
  cancel: (id: number) => app.dispatch(DownloadsMsg.cases.DownloadCancelClicked.make({ id })),
};

const B = BookmarksMsg.cases;

/** The picker's verbs. Leaving `id` out acts on the selected row, as the keyboard does. */
export const bookmarks = {
  get open() {
    return app.model.bookmarks.open;
  },
  get query() {
    return app.model.bookmarks.query;
  },
  get rows() {
    return app.model.bookmarks.rows;
  },
  get selected() {
    return app.model.bookmarks.selected;
  },
  get opened() {
    return app.model.bookmarks.opened;
  },
  filter: (query: string) => app.dispatch(B.BookmarksQueryChanged.make({ query })),
  move: (by: number) => app.dispatch(B.BookmarkSelectionMoved.make({ by })),
  pick: (id?: number) => app.dispatch(B.BookmarkPicked.make({ id })),
  remove: (id?: number) => app.dispatch(B.BookmarkDeleteRequested.make({ id })),
  dismiss: () => app.dispatch(B.BookmarksDismissed.make({})),
  blurred: (handBack: boolean) => app.dispatch(B.BookmarksBlurred.make({ handBack })),
};

export const ui = {
  get searchUrl() {
    return app.model.ui.settings.searchUrl;
  },
};

const L = LayoutMsg.cases;
const placement = (id: ElementId): Placement => app.model.ui.settings.layout[id];

/** Where elements go, and whether each has anything to show right now. */
export const layout = {
  elementsIn: (region: Region): ReadonlyArray<ElementId> => regions(app.model.ui)[region],
  size: (id: ElementId): string | undefined => placement(id).size,
  get tabStrip(): TabStripState {
    return tabStrip(app.model.layout, placement("tabs"));
  },
  get tabsAutohide(): boolean {
    return placement("tabs").autohide;
  },
  get omniboxShown(): boolean {
    return omniboxShown(app.model.layout, placement("omnibox"));
  },
  /** The layout hides the omnibox, so it only exists while summoned. */
  get omniboxHidden(): boolean {
    return !placement("omnibox").visible;
  },
  get findShown(): boolean {
    return findShown(app.model.main, placement("find"));
  },
  get statusLine(): StatusLine | null {
    return statusLine(app.model.main, app.model.ui.settings.layout);
  },
  get completionShown(): boolean {
    return placement("completion").visible;
  },
  tabStripHovered: () => app.dispatch(L.TabStripHovered.make({})),
  tabStripLeft: () => app.dispatch(L.TabStripLeft.make({})),
  omniboxDismissed: () => app.dispatch(L.OmniboxDismissed.make({})),
};

/** The verbs the omnibox, the tab strip and the command line ask main for. */
export const browse = {
  navigate: (url: string) => ask(I.NavigationRequested.make({ url })),
  goBack: () => ask(I.BackRequested.make({})),
  goForward: () => ask(I.ForwardRequested.make({})),
  reload: () => ask(I.ReloadRequested.make({})),
  toggleDevTools: () => ask(I.DevToolsToggled.make({})),
  runCommand: (line: string) => ask(I.CommandEntered.make({ line })),
  setMode: (mode: "insert" | "command" | "find") => ask(I.ModeRequested.make({ mode })),
  createTab: () => ask(I.TabRequested.make({ url: undefined })),
  closeTab: (id: TabId) => ask(I.TabCloseRequested.make({ id })),
  activateTab: (id: TabId) => ask(I.TabActivated.make({ id })),
  omniboxSuggestions: queries.omniboxSuggestions,
  commandCompletions: queries.commandCompletions,
};

/**
 * The slot that last mounted owns the report. When the tab strip moves, the
 * new slot can mount before the old one is destroyed, and the old one's
 * "gone" must not land after the new one's rect.
 */
let slotOwner: symbol | null = null;
let reportedSlot = "";

function sendSlot(rect: Rect | null): void {
  const key = JSON.stringify(rect);

  if (key === reportedSlot) return;
  reportedSlot = key;
  ask(I.WindowControlsMeasured.make({ rect }));
}

/** The window's own buttons, which sit at the tab strip's outer end. */
export const windowControls = {
  /** False until main has said which platform this is. */
  get known() {
    return app.model.main.window.platform !== "";
  },
  /** macOS draws its own; the chrome only keeps room for them. */
  get native() {
    return app.model.main.window.platform === "darwin";
  },
  get maximized() {
    return app.model.main.window.maximized;
  },
  get fullscreen() {
    return app.model.main.window.fullscreen;
  },
  press: (control: WindowControl) => ask(I.WindowControlPressed.make({ control })),
  /**
   * Keeps main told where the buttons' slot is. A slot that CSS hides, or
   * one that leaves the page, is no slot, so macOS hides its buttons too.
   */
  slot: (node: HTMLElement) => {
    const id = Symbol("window-controls");

    slotOwner = id;

    const report = (): void => {
      if (slotOwner !== id) return;
      const box = node.getBoundingClientRect();
      const shown = box.width > 0 && box.height > 0;

      sendSlot(shown ? { x: box.x, y: box.y, width: box.width, height: box.height } : null);
    };

    const observer = new ResizeObserver(report);
    const styles = new MutationObserver(report);

    observer.observe(node);
    styles.observe(document.head, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", report);
    afterLayoutChange(report);

    return {
      destroy() {
        observer.disconnect();
        styles.disconnect();
        window.removeEventListener("resize", report);

        if (slotOwner !== id) return;
        slotOwner = null;
        sendSlot(null);
      },
    };
  },
};

export interface CompletionOverlayClient {
  show(state: CompletionOverlayState): void;
  hide(): void;
  release(): void;
}

/**
 * One overlay, two inputs. The input that showed the list last owns it, even
 * after a hide: the blur that hides the list lands before the pick does. An
 * input that does not own the overlay cannot hide it.
 */
let owner: symbol | null = null;

export const completionOverlay = {
  claim(onAccept: (candidate: CompletionCandidate) => void): CompletionOverlayClient {
    const id = Symbol("completion-client");

    const hide = (): void => {
      if (owner === id) ask(I.CompletionOverlayChanged.make({ state: null }));
    };

    return {
      show(state) {
        owner = id;
        claimCompletion(onAccept);
        ask(I.CompletionOverlayChanged.make({ state }));
      },
      hide,
      release() {
        hide();

        if (owner === id) owner = null;
      },
    };
  },
};

/**
 * Runs `report` once each layout change is in the DOM. A move that keeps an
 * element's size fires no ResizeObserver. Untracked: a report that dispatches
 * replaces the model, which would re-run the effect. Call it from an action.
 */
export function afterLayoutChange(report: () => void): void {
  const layout = $derived(app.model.ui.settings.layout);
  const reportFor = (_layout: Layout): void => untrack(report);

  $effect(() => reportFor(layout));
}

/**
 * Keeps main told where page content goes: the content box, not the border
 * box, because the tab's native layer would cover a border. The page's
 * corners follow the frame's inner curve, which is the radius less the
 * border and padding.
 */
export const contentRect = (node: HTMLElement) => {
  const report = (): void => {
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const padLeft = parseFloat(style.paddingLeft);
    const padTop = parseFloat(style.paddingTop);

    const rect: Rect = {
      x: Math.round(box.x + node.clientLeft + padLeft),
      y: Math.round(box.y + node.clientTop + padTop),
      width: Math.round(node.clientWidth - padLeft - parseFloat(style.paddingRight)),
      height: Math.round(node.clientHeight - padTop - parseFloat(style.paddingBottom)),
    };

    const inset = Math.max(node.clientLeft + padLeft, node.clientTop + padTop);
    const outer = parseFloat(style.borderTopLeftRadius) || 0;
    const radius = Math.max(0, Math.round(outer - inset));

    ask(I.ContentRectMeasured.make({ rect, radius }));
  };

  const observer = new ResizeObserver(report);
  // A stylesheet can change the frame's corners without resizing it.
  const styles = new MutationObserver(report);

  observer.observe(node);
  styles.observe(document.head, { childList: true, subtree: true, characterData: true });
  window.addEventListener("resize", report);

  afterLayoutChange(report);

  return {
    destroy() {
      observer.disconnect();
      styles.disconnect();
      window.removeEventListener("resize", report);
    },
  };
};

const swatch = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

/**
 * CSS colours painted bottom to top, as one `#rrggbb`. A canvas reads every
 * syntax CSS does and blends translucent layers. Null while the stack is not
 * opaque: the window's own colour would show through, and that is unknown.
 */
function paintedHex(layers: ReadonlyArray<string>): string | null {
  if (swatch === null) return null;
  swatch.clearRect(0, 0, 1, 1);

  for (const color of layers) {
    swatch.fillStyle = color;
    swatch.fillRect(0, 0, 1, 1);
  }

  const [r = 0, g = 0, b = 0, alpha = 0] = swatch.getImageData(0, 0, 1, 1).data;

  if (alpha < 255) return null;

  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Keeps the window's native background the colour the chrome paints, which
 * is what a resize shows before the next frame. Main cannot read CSS, so the
 * chrome measures it when a stylesheet, the OS scheme or the viewport changes.
 */
export const windowBackground = (node: HTMLElement) => {
  let reported: string | null = null;

  const report = (): void => {
    const color = paintedHex([
      getComputedStyle(document.body).backgroundColor,
      getComputedStyle(node).backgroundColor,
    ]);

    if (color === null || color === reported) return;
    reported = color;
    ask(I.ChromeBackgroundMeasured.make({ color }));
  };

  const styles = new MutationObserver(report);
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");

  styles.observe(document.head, { childList: true, subtree: true, characterData: true });
  scheme.addEventListener("change", report);
  window.addEventListener("resize", report);
  report();

  return {
    destroy() {
      styles.disconnect();
      scheme.removeEventListener("change", report);
      window.removeEventListener("resize", report);
    },
  };
};
