import type { TabOrientation, UserConfig } from "./config";

export type TabId = number;

export type Mode = "normal" | "insert" | "command" | "hint" | "find" | "prompt";

/** Scrolling lives in the page, so main names the movement rather than the pixels. */
export type ScrollCommand = "down" | "up" | "half-down" | "half-up" | "top" | "bottom";

export interface TabState {
  id: TabId;
  title: string;
  url: string;
  favicon: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /**
   * The page's current zoom level (0 = 100%, +1 / -1 ≈ 20% step). Mirrored
   * here so the chrome can show it without reaching back into main.
   */
  zoomLevel: number;
}

/** Where a find has got to, as `found-in-page` reports it. */
export interface FindResult {
  query: string;
  matches: number;
  /** 1-based index of the highlighted match; 0 when there are none. */
  active: number;
}

export interface BrowserState {
  tabs: TabState[];
  activeId: TabId | null;
}

/** Where a download has got to, as Chromium's `DownloadItem` reports it. */
export type DownloadStatus = "progressing" | "paused" | "completed" | "cancelled" | "interrupted";

export interface DownloadState {
  /** Ours, not Chromium's — a `DownloadItem` carries no stable identifier. */
  id: number;
  /** Basename of the path we chose, which is not always what the server suggested. */
  filename: string;
  url: string;
  status: DownloadStatus;
  receivedBytes: number;
  /** 0 when the server sent no length, which is what makes progress unknowable. */
  totalBytes: number;
  /**
   * Smoothed throughput, and 0 once a transfer stops. Measured in main: the
   * chrome only sees throttled snapshots, and none at all while a transfer
   * stalls, so it has no stream of samples to average.
   */
  bytesPerSecond: number;
}

/** One row of the context menu; a separator is a row of its own. */
export type ContextMenuItem =
  | { type: "separator" }
  | {
      type: "item";
      id: string;
      label: string;
      enabled: boolean;
      /** Right-aligned hint slot, reserved for e.g. keybinds; unset for now. */
      hint?: string;
    };

/**
 * Everything the page needs to render its context menu, in page coordinates.
 * null hides the menu instead.
 */
export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
  /**
   * tokens + menu styles + the user's config.css, injected into the menu's
   * shadow root so it themes exactly like the chrome.
   */
  css: string;
}

/**
 * A line of feedback for the echo area. `error` is for something the user
 * did or wrote that could not be used; `info` for everything else.
 */
export interface Message {
  text: string;
  level: "info" | "error";
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A permission a page may be asked about rather than silently granted or denied. */
export type PromptablePermission = "media" | "geolocation" | "notifications" | "clipboard-read";

/**
 * Payload of `toChrome.restoreSession`, sent on startup when a saved
 * session exists. Main restores the tabs itself; only the orientation
 * reaches the chrome, which seeds its override from the saved flip before
 * the first paint. `null` means "follow config".
 */
export interface RestoreSessionState {
  orientation: TabOrientation | null;
}

/**
 * A question the chrome renders as a one-line prompt. The union leaves
 * room for future kinds without a channel change. The id travels
 * separately so the queue owns it end-to-end and the asker never invents
 * or strips one.
 */
export type PromptState =
  | {
      kind: "permission";
      origin: string;
      permission: PromptablePermission;
      mediaTypes?: ("video" | "audio")[];
    }
  | {
      kind: "session-restore";
      tabCount: number;
    }
  | {
      kind: "external-protocol";
      /**
       * The page asking, or null when nothing asked on a page's behalf — a
       * typed URL, `:tabnew`, or a restored session tab. The user's own
       * choice, but still asked once per scheme: the OS sees the same
       * request either way.
       */
      origin: string | null;
      scheme: string;
      /** Shown truncated in the prompt line: the scheme alone does not say what is being sent to the OS. */
      url: string;
    };

/** The wire shape of a queued prompt: the state plus the id the queue stamped. */
export interface PromptWire {
  id: number;
  state: PromptState;
}

/**
 * One row offered while typing in the omnibox: a concrete destination, not
 * typed search text — accepting one navigates straight to `value`, without
 * a re-resolve. `kind` picks the badge `completion.svelte.ts` renders so a
 * bookmarked row reads differently from a history-only one.
 */
export interface OmniboxSuggestion {
  label: string;
  value: string;
  kind: "bookmark" | "history";
}

/**
 * One row of a completion list, generic over what is being completed. Shared
 * rather than renderer-owned because the list is rendered in an overlay view
 * of its own, and the candidate crosses main to get there and back.
 */
export interface CompletionCandidate {
  label: string;
  value: string;
  hint?: string;
  /**
   * A free-form tag such as "bookmark", "history", "search", or "command".
   * Nothing here has a fixed vocabulary for it — a kind becomes a one-letter
   * badge (its first character) coloured by `--kv-completion-kind-<kind>-fg`,
   * a token the caller's feature defines.
   */
  kind?: string;
}

/**
 * Which edge of its anchor a completion list grows from. The omnibox sits
 * above the page and grows down; the command line sits below it and grows up.
 */
export type CompletionGrow = "down" | "up";

/**
 * What the completion overlay renders, and what main places it by. `anchor`
 * is the input the list belongs to, measured in the chrome's own coordinates
 * — the same frame `setContentRect` reports in, so main can hand it to
 * `setBounds` without translating.
 */
export interface CompletionOverlayState {
  candidates: CompletionCandidate[];
  /** The highlighted row, or -1 when nothing is selected yet. */
  index: number;
  anchor: Rect;
  grow: CompletionGrow;
}

/**
 * Position of the list inside its view, in CSS pixels.
 *
 * View bounds are whole pixels but the omnibox sits on fractions (`ch`
 * padding), so the view contains the list, whose border lands exactly on
 * the chrome's.
 */
export interface CompletionInset {
  left: number;
  top: number;
  width: number;
}

/**
 * A channel and what it carries. `payload` is a phantom: it never exists at
 * runtime, it is only how the type travels from the table to both sides.
 */
export interface Channel<T> {
  readonly payload: T;
}

export type AnyTable = Record<string, Channel<unknown>>;
export type PayloadOf<C> = C extends Channel<infer T> ? T : never;

/**
 * A query channel: chrome asks, main answers, riding
 * `ipcRenderer.invoke`/`ipcMain.handle`. Two fire-and-forget sends cannot
 * return an answer in the same call. `request`/`response` are phantom,
 * the same way `Channel`'s `payload` is.
 */
export interface Query<Req, Res> {
  readonly request: Req;
  readonly response: Res;
}

export type AnyQueryTable = Record<string, Query<unknown, unknown>>;
export type RequestOf<Q> = Q extends Query<infer Req, unknown> ? Req : never;
export type ResponseOf<Q> = Q extends Query<unknown, infer Res> ? Res : never;

/** A query table's method: request in, response out. */
export type Queries<T extends AnyQueryTable> = {
  [K in keyof T]: (request: RequestOf<T[K]>) => Promise<ResponseOf<T[K]>>;
};

/**
 * The method a channel becomes. A channel that carries nothing takes no
 * argument, and one that may carry nothing takes an optional one.
 */
type Send<P> = [P] extends [void]
  ? () => void
  : undefined extends P
    ? (payload?: P) => void
    : (payload: P) => void;

/** Sending half of a table: one method per channel, named as the channel is. */
export type Senders<T extends AnyTable> = {
  [K in keyof T]: Send<PayloadOf<T[K]>>;
};

/** Receiving half: `on` + the channel name, returning an unsubscribe. */
export type Listeners<T extends AnyTable> = {
  [K in keyof T & string as `on${Capitalize<K>}`]: (
    listener: (payload: PayloadOf<T[K]>) => void,
  ) => () => void;
};

/**
 * The wire name, derived rather than written: a channel is declared once, and
 * `kvist:cancel-download` is nobody's business but this file's.
 */
export function wire(key: string): string {
  return `kvist:${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

const claimed = new Set<string>();

/**
 * Channels share one wire namespace, so two tables must not claim one name —
 * a collision would deliver each table's payload to the other's handler.
 */
export function table<T extends AnyTable>(channels: T): T {
  for (const key of Object.keys(channels)) {
    const name = wire(key);
    if (claimed.has(name)) throw new Error(`kvist: duplicate channel ${name}`);
    claimed.add(name);
  }
  return channels;
}

/**
 * Same claim as `table()`, over the query namespace instead — a query and a
 * fire-and-forget channel share the one wire namespace `claimed` tracks, so
 * a query cannot silently steal a name a `Channel` already owns, or the
 * other way round.
 */
export function queryTable<T extends AnyQueryTable>(channels: T): T {
  for (const key of Object.keys(channels)) {
    const name = wire(key);
    if (claimed.has(name)) throw new Error(`kvist: duplicate channel ${name}`);
    claimed.add(name);
  }
  return channels;
}

/**
 * Creates a channel declaration. The payload type T exists only at compile
 * time; the channel itself is an empty object whose type carries the payload
 * information.
 */
function channel<T>(): Channel<T> {
  // SAFETY: `payload` is phantom — the object deliberately carries nothing; T travels in the type only.
  return {} as Channel<T>;
}

/**
 * Creates a query declaration. `Req`/`Res` exist only at compile time, the
 * same way `channel`'s `T` does.
 */
function query<Req, Res>(): Query<Req, Res> {
  // SAFETY: `request`/`response` are phantom — the object deliberately carries nothing; Req/Res travel in the type only.
  return {} as Query<Req, Res>;
}

/** Chrome → main. Accepted only from the window's own webContents. */
export const toMain = table({
  setContentRect: channel<Rect>(),
  runCommand: channel<string>(),
  setMode: channel<Mode>(),
  createTab: channel<string | undefined>(),
  closeTab: channel<TabId>(),
  activateTab: channel<TabId>(),
  navigate: channel<string>(),
  goBack: channel<void>(),
  goForward: channel<void>(),
  reload: channel<void>(),
  toggleDevTools: channel<void>(),
  /** Restarts the search from the top; an empty query stops it. */
  find: channel<string>(),
  stopFind: channel<void>(),
  /** Stops one transfer; anything that has already stopped is left alone. */
  cancelDownload: channel<number>(),
  /** Answers the prompt carrying the id; anything else is stale and ignored. */
  answerPrompt: channel<{ id: number; allow: boolean }>(),
  /**
   * The chrome's orientation override — null when following config.
   * Mirrored on every flip and clear so main persists it with the session
   * and replays it on relaunch. Sent explicitly even when null: a
   * never-flipped window differs from a cleared one.
   */
  orientationOverride: channel<TabOrientation | null>(),
  /**
   * What the completion overlay should show, or null to close it. The chrome
   * owns the list and its selection; this is the mirror main places and
   * paints on its behalf.
   */
  completionOverlay: channel<CompletionOverlayState | null>(),
});

/** Main → chrome. Full snapshots, never diffs. */
export const toChrome = table({
  state: channel<BrowserState>(),
  config: channel<UserConfig>(),
  mode: channel<Mode>(),
  /** Chrome focuses its own omnibox input; main only moves window focus. */
  focusOmnibox: channel<void>(),
  findResult: channel<FindResult | null>(),
  downloads: channel<DownloadState[]>(),
  /** `:downloads` asking the chrome to pin its panel open, or let it go again. */
  downloadsToggle: channel<void>(),
  /** The echo area: what to show, or null to clear it. */
  message: channel<Message | null>(),
  /** The prompt waiting for an answer, or null when none is. */
  prompt: channel<PromptWire | null>(),
  /**
   * A saved session exists, sent once the chrome loads. The chrome
   * seeds its orientation override from the payload; main restores the
   * tabs itself, so URLs and bounds never leave main. Missing or
   * malformed rows look like a first launch.
   */
  restoreSession: channel<RestoreSessionState>(),
  /** A row the user clicked in the completion overlay, relayed back to accept. */
  completionAccept: channel<CompletionCandidate>(),
});

/**
 * Main → the completion overlay view. Separate from `toChrome` because the
 * overlay is a different webContents with a far smaller surface: it renders
 * a list and nothing else.
 */
export const toOverlay = table({
  completionState: channel<CompletionOverlayState>(),
  /** Where to draw the list inside the view main has sized for it. */
  completionInset: channel<CompletionInset>(),
  /** The user's config.css, injected unlayered so a retheme reaches the menu too. */
  completionCss: channel<string>(),
});

/**
 * The completion overlay → main. Accepted only from the overlay's own
 * webContents, the same way `fromPage` is gated on owning a tab.
 */
export const fromOverlay = table({
  /**
   * How tall the rendered list is. Only the overlay can know: the height
   * follows the row count and the styling, neither of which main should
   * have to model.
   */
  completionHeight: channel<number>(),
  /**
   * Send the candidate, not its index: clicking blurs the input
   * and may clear its list before this arrives.
   */
  completionPick: channel<CompletionCandidate>(),
});

/**
 * Chrome → main, request/response. Kept separate from `toMain` because a
 * query needs its answer back in the same call, which `Send`'s
 * fire-and-forget shape cannot express.
 */
export const toMainQueries = queryTable({
  /** Candidates for the omnibox's dropdown, merged from history and bookmarks. */
  omniboxSuggestions: query<string, OmniboxSuggestion[]>(),
});

/**
 * A tab → main. Accepted only from a webContents that owns a Tab, which is
 * why these are a table of their own rather than a flag on the one above.
 */
export const fromPage = table({
  /** A tab reporting whether its focused element accepts typing. */
  pageEditable: channel<boolean>(),
  /**
   * Where the page wants a real click. Chromium marks history entries created
   * without user activation as skippable, and a scripted `.click()` has none —
   * so back would silently stop working after following a hint.
   */
  hintsClick: channel<Point>(),
  /** The page reporting that hinting ended, so main can leave hint mode. */
  hintsDone: channel<void>(),
  /** The picked item id, or null when the menu was dismissed without one. */
  contextMenuPick: channel<string | null>(),
});

/** Main → a tab. Hint mode, scrolling and the context menu all live in the page. */
export const toPage = table({
  /** Asks a tab to blur whatever it has focused, so normal mode regains the keyboard. */
  pageBlur: channel<void>(),
  pageScroll: channel<ScrollCommand>(),
  hintsShow: channel<void>(),
  hintsKey: channel<string>(),
  hintsHide: channel<void>(),
  /**
   * What to show, or null to hide. Rendered in the page itself, because the
   * tab's view paints over the chrome and chrome HTML can never overlap it.
   */
  contextMenu: channel<ContextMenuState | null>(),
});

/**
 * Binds a table's sending half to a transport. Pure, so the tables can be
 * bound to `ipcRenderer`, to a `webContents`, or to nothing in a test.
 */
export function senders<T extends AnyTable>(
  channels: T,
  send: (channel: string, payload?: unknown) => void,
): Senders<T> {
  const api: Record<string, (payload?: unknown) => void> = {};
  for (const key of Object.keys(channels)) {
    const name = wire(key);
    api[key] = (payload) => send(name, payload);
  }
  // SAFETY: one method per key of T was built above; the transport erases payload types.
  return api as Senders<T>;
}

/** Binds a table's receiving half; `subscribe` answers with an unsubscribe. */
export function listeners<T extends AnyTable>(
  channels: T,
  subscribe: (channel: string, listener: (payload: unknown) => void) => () => void,
): Listeners<T> {
  const api: Record<string, (listener: (payload: unknown) => void) => () => void> = {};
  for (const key of Object.keys(channels)) {
    const name = wire(key);
    api[`on${key[0]!.toUpperCase()}${key.slice(1)}`] = (listener) => subscribe(name, listener);
  }
  // SAFETY: one onX method per key of T was built above; the transport erases payload types.
  return api as unknown as Listeners<T>;
}

/**
 * Binds a query table's sending half to a transport. Pure, like `senders`
 * and `listeners` — bindable to `ipcRenderer.invoke`, or to a fake in a test.
 */
export function invokers<T extends AnyQueryTable>(
  channels: T,
  invoke: (channel: string, request: unknown) => Promise<unknown>,
): Queries<T> {
  const api: Record<string, (request: unknown) => Promise<unknown>> = {};
  for (const key of Object.keys(channels)) {
    const name = wire(key);
    api[key] = (request) => invoke(name, request);
  }
  // SAFETY: one method per key of T was built above; the transport erases request/response types.
  return api as Queries<T>;
}

/** What the preload exposes as `window.kvist`, derived from the tables. */
export type KvistApi = Senders<typeof toMain> &
  Listeners<typeof toChrome> &
  Queries<typeof toMainQueries>;

/**
 * What the overlay preload exposes. Deliberately not `KvistApi`: the overlay
 * renders a list, and handing it the chrome's whole surface would let a
 * dropdown navigate tabs.
 */
export type OverlayApi = Senders<typeof fromOverlay> & Listeners<typeof toOverlay>;
