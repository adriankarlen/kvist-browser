import { untrack } from "svelte";
import { ChromeIntent } from "../../shared/rpc/chrome";
import type { Rect, TabId } from "../../shared/schema/browser";
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
import type { ElementId, Layout, Region } from "../../shared/layout";

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

export const vim = {
  get mode() {
    return app.model.main.mode;
  },
  /** Hands control back to the page; main moves focus off the chrome. */
  toNormal: () => ask(I.ModeRequested.make({ mode: "normal" })),
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
    return panelVisible(app.model.downloads);
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

/** The status row is the command line, a prompt or a message, in that order. */
const statusShowing = (): boolean =>
  vim.mode === "command" || prompts.current !== null || messages.current !== null;

/** Find outlives its prompt: matches stay highlighted for n and N. */
const findShowing = (): boolean => vim.mode === "find" || find.active;

export const layout = {
  elementsIn: (region: Region): ReadonlyArray<ElementId> => regions(app.model.ui)[region],
  size: (id: ElementId): string | undefined => app.model.ui.settings.layout[id].size,
  /** Whether an element has anything to show right now; a region with none is left out. */
  showing: (id: ElementId): boolean => {
    switch (id) {
      case "tabs":
      case "omnibox":
        return true;
      case "bookmarks":
        return bookmarks.open;
      case "downloads":
        return downloads.visible;
      case "status":
        return statusShowing();
      case "find":
        return findShowing();
      case "completion":
        return false;
    }
  },
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
 * Keeps main told where page content goes: the content box, not the border
 * box, because the tab's native layer would cover a border.
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

    ask(I.ContentRectMeasured.make({ rect }));
  };

  const observer = new ResizeObserver(report);

  observer.observe(node);
  window.addEventListener("resize", report);

  // A layout change can move the box without resizing it, which no
  // ResizeObserver reports. An effect runs once the change is in the DOM.
  // Reporting is untracked: it dispatches, and the model it replaces would
  // re-run the effect.
  const layout = $derived(app.model.ui.settings.layout);
  const reportFor = (_layout: Layout): void => untrack(report);

  $effect(() => reportFor(layout));

  return {
    destroy() {
      observer.disconnect();
      window.removeEventListener("resize", report);
    },
  };
};
