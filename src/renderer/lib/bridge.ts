import { Effect, Stream } from "effect";
import { type ChromeEvent, ChromeIntent, ChromeRpcs } from "../../shared/rpc/chrome";
import { EventListeners, openClient, receivePort } from "../../shared/rpc/client";
import type {
  BrowserState,
  FindResult,
  Message,
  Mode,
  Rect,
  RestoreSessionState,
  TabId,
} from "../../shared/schema/browser";
import type {
  CompletionCandidate,
  CompletionOverlayState,
  OmniboxSuggestion,
} from "../../shared/schema/completion";
import type { TabOrientation, UserConfig } from "../../shared/schema/config";
import type { DownloadState } from "../../shared/schema/downloads";
import type { PromptAnswer, PromptWire } from "../../shared/schema/prompts";

type Unsubscribe = () => void;

/**
 * The chrome's view of main, as calls. Every method rides the chrome's RPC
 * port: `on…` listens to the event stream, the rest dispatch an intent or
 * ask a question.
 */
export interface ChromeBridge {
  setContentRect(rect: Rect): void;
  runCommand(line: string): void;
  setMode(mode: Mode): void;
  createTab(url?: string): void;
  closeTab(id: TabId): void;
  activateTab(id: TabId): void;
  navigate(url: string): void;
  goBack(): void;
  goForward(): void;
  reload(): void;
  toggleDevTools(): void;
  find(query: string): void;
  stopFind(): void;
  cancelDownload(id: number): void;
  answerPrompt(answer: PromptAnswer): void;
  orientationOverride(orientation: TabOrientation | null): void;
  completionOverlay(state: CompletionOverlayState | null): void;
  onState(listener: (state: BrowserState) => void): Unsubscribe;
  onConfig(listener: (config: UserConfig) => void): Unsubscribe;
  onMode(listener: (mode: Mode) => void): Unsubscribe;
  onFocusOmnibox(listener: () => void): Unsubscribe;
  onFindResult(listener: (result: FindResult | null) => void): Unsubscribe;
  onDownloads(listener: (downloads: ReadonlyArray<DownloadState>) => void): Unsubscribe;
  onDownloadsToggle(listener: () => void): Unsubscribe;
  onMessage(listener: (message: Message | null) => void): Unsubscribe;
  onPrompt(listener: (prompt: PromptWire | null) => void): Unsubscribe;
  onRestoreSession(listener: (session: RestoreSessionState) => void): Unsubscribe;
  onCompletionAccept(listener: (candidate: CompletionCandidate) => void): Unsubscribe;
  omniboxSuggestions(query: string): Promise<ReadonlyArray<OmniboxSuggestion>>;
  commandCompletions(line: string): Promise<ReadonlyArray<CompletionCandidate>>;
}

/**
 * Connects once and answers at once: calls made before the port arrives
 * wait for it, in the order they were made.
 */
export function createChromeBridge(ask: () => void): ChromeBridge {
  const events = new EventListeners<ChromeEvent>();
  const client = receivePort(ask).then((port) => openClient(ChromeRpcs, port));

  void client.then((rpc) =>
    Effect.runFork(
      Stream.runForEach(rpc.Subscribe(), (event) => Effect.sync(() => events.emit(event))),
    ),
  );

  const intent = ChromeIntent.cases;

  const dispatch = (message: ChromeIntent): void =>
    void client.then((rpc) => Effect.runFork(rpc.Dispatch(message)));

  return {
    setContentRect: (rect) => dispatch(intent.ContentRectMeasured.make({ rect })),
    runCommand: (line) => dispatch(intent.CommandEntered.make({ line })),
    setMode: (mode) => dispatch(intent.ModeRequested.make({ mode })),
    createTab: (url) => dispatch(intent.TabRequested.make({ url })),
    closeTab: (id) => dispatch(intent.TabCloseRequested.make({ id })),
    activateTab: (id) => dispatch(intent.TabActivated.make({ id })),
    navigate: (url) => dispatch(intent.NavigationRequested.make({ url })),
    goBack: () => dispatch(intent.BackRequested.make({})),
    goForward: () => dispatch(intent.ForwardRequested.make({})),
    reload: () => dispatch(intent.ReloadRequested.make({})),
    toggleDevTools: () => dispatch(intent.DevToolsToggled.make({})),
    find: (query) => dispatch(intent.FindRequested.make({ query })),
    stopFind: () => dispatch(intent.FindStopped.make({})),
    cancelDownload: (id) => dispatch(intent.DownloadCancelRequested.make({ id })),
    answerPrompt: ({ id, allow }) => dispatch(intent.PromptAnswered.make({ id, allow })),
    orientationOverride: (orientation) =>
      dispatch(intent.OrientationOverridden.make({ orientation })),
    completionOverlay: (state) => dispatch(intent.CompletionOverlayChanged.make({ state })),
    onState: (listener) => events.on("StateChanged", ({ state }) => listener(state)),
    onConfig: (listener) => events.on("ConfigChanged", ({ config }) => listener(config)),
    onMode: (listener) => events.on("ModeChanged", ({ mode }) => listener(mode)),
    onFocusOmnibox: (listener) => events.on("OmniboxFocusRequested", () => listener()),
    onFindResult: (listener) => events.on("FindResultChanged", ({ result }) => listener(result)),
    onDownloads: (listener) =>
      events.on("DownloadsChanged", ({ downloads }) => listener(downloads)),
    onDownloadsToggle: (listener) => events.on("DownloadsToggled", () => listener()),
    onMessage: (listener) => events.on("MessageChanged", ({ message }) => listener(message)),
    onPrompt: (listener) => events.on("PromptChanged", ({ prompt }) => listener(prompt)),
    onRestoreSession: (listener) =>
      events.on("SessionRestored", ({ session }) => listener(session)),
    onCompletionAccept: (listener) =>
      events.on("CompletionPicked", ({ candidate }) => listener(candidate)),
    omniboxSuggestions: (query) =>
      client.then((rpc) => Effect.runPromise(rpc.OmniboxSuggestions({ query }))),
    commandCompletions: (line) =>
      client.then((rpc) => Effect.runPromise(rpc.CommandCompletions({ line }))),
  };
}
