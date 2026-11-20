import { ChromeEvent } from "../shared/rpc/chrome";
import { OverlayEvent } from "../shared/rpc/overlay";
import { PageEvent } from "../shared/rpc/page";
import type {
  BrowserState,
  FindResult,
  Message,
  Mode,
  RestoreSessionState,
  ScrollCommand,
} from "../shared/schema/browser";
import type {
  CompletionCandidate,
  CompletionInset,
  CompletionOverlayState,
} from "../shared/schema/completion";
import type { UserConfig } from "../shared/schema/config";
import type { ContextMenuState } from "../shared/schema/context-menu";
import type { DownloadState } from "../shared/schema/downloads";
import type { PromptWire } from "../shared/schema/prompts";
import { EventLink } from "./services/event-link";

/** A surface's events, and the calls main makes to publish them. */
export interface Link<E extends { readonly _tag: string }, S> {
  readonly events: EventLink<E>;
  readonly send: S;
}

/** What main says to the chrome, as calls; each one publishes an event. */
export interface ChromeSenders {
  state(state: BrowserState): void;
  config(config: UserConfig): void;
  mode(mode: Mode): void;
  focusOmnibox(): void;
  findResult(result: FindResult | null): void;
  downloads(downloads: ReadonlyArray<DownloadState>): void;
  downloadsToggle(): void;
  message(message: Message | null): void;
  prompt(prompt: PromptWire | null): void;
  restoreSession(session: RestoreSessionState): void;
  completionAccept(candidate: CompletionCandidate): void;
}

export function chromeLink(): Link<ChromeEvent, ChromeSenders> {
  const events = new EventLink<ChromeEvent>([
    "StateChanged",
    "ConfigChanged",
    "ModeChanged",
    "FindResultChanged",
    "DownloadsChanged",
    "MessageChanged",
    "PromptChanged",
    "SessionRestored",
  ]);

  const event = ChromeEvent.cases;

  return {
    events,
    send: {
      state: (state) => events.publish(event.StateChanged.make({ state })),
      config: (config) => events.publish(event.ConfigChanged.make({ config })),
      mode: (mode) => events.publish(event.ModeChanged.make({ mode })),
      focusOmnibox: () => events.publish(event.OmniboxFocusRequested.make({})),
      findResult: (result) => events.publish(event.FindResultChanged.make({ result })),
      downloads: (downloads) => events.publish(event.DownloadsChanged.make({ downloads })),
      downloadsToggle: () => events.publish(event.DownloadsToggled.make({})),
      message: (message) => events.publish(event.MessageChanged.make({ message })),
      prompt: (prompt) => events.publish(event.PromptChanged.make({ prompt })),
      restoreSession: (session) => events.publish(event.SessionRestored.make({ session })),
      completionAccept: (candidate) => events.publish(event.CompletionPicked.make({ candidate })),
    },
  };
}

/** What main says to one tab. */
export interface PageSenders {
  pageBlur(): void;
  pageScroll(command: ScrollCommand): void;
  hintsShow(): void;
  hintsKey(key: string): void;
  hintsHide(): void;
  contextMenu(menu: ContextMenuState | null): void;
}

export function pageLink(): Link<PageEvent, PageSenders> {
  const events = new EventLink<PageEvent>(["ContextMenuChanged"]);
  const event = PageEvent.cases;

  return {
    events,
    send: {
      pageBlur: () => events.publish(event.BlurRequested.make({})),
      pageScroll: (command) => events.publish(event.ScrollRequested.make({ command })),
      hintsShow: () => events.publish(event.HintsShown.make({})),
      hintsKey: (key) => events.publish(event.HintKeyPressed.make({ key })),
      hintsHide: () => events.publish(event.HintsHidden.make({})),
      contextMenu: (menu) => events.publish(event.ContextMenuChanged.make({ menu })),
    },
  };
}

/** What main says to the completion overlay. All of it is state, so all of it is replayed. */
export interface OverlaySenders {
  completionState(state: CompletionOverlayState): void;
  completionInset(inset: CompletionInset): void;
  completionCss(css: string): void;
}

export function overlayLink(): Link<OverlayEvent, OverlaySenders> {
  const events = new EventLink<OverlayEvent>([
    "CompletionStateChanged",
    "CompletionInsetChanged",
    "CompletionCssChanged",
  ]);

  const event = OverlayEvent.cases;

  return {
    events,
    send: {
      completionState: (state) => events.publish(event.CompletionStateChanged.make({ state })),
      completionInset: (inset) => events.publish(event.CompletionInsetChanged.make({ inset })),
      completionCss: (css) => events.publish(event.CompletionCssChanged.make({ css })),
    },
  };
}
