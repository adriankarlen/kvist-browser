import type { PromptState } from "../shared/ipc";
import type { PageContents } from "./page-host";
import type { Prompts } from "./prompts";

/**
 * Schemes Chromium loads inside a tab itself — genuinely (`http`,
 * `https`, `kvist`, `file`) or by failing the navigation (`about`,
 * `chrome`, `devtools`, ...). None is a candidate for the desktop:
 * `file:` already works or already fails, in a tab.
 */
const NATIVE_SCHEMES = new Set([
  "http",
  "https",
  "kvist",
  "file",
  "data",
  "blob",
  "filesystem",
  "javascript",
  "about",
  "chrome",
  "chrome-extension",
  "devtools",
  "view-source",
]);

/**
 * The scheme a URL hands to the desktop instead of the tab, or null for a
 * scheme the browser loads itself. Every other scheme is a candidate,
 * since native-app schemes cannot be enumerated; `ExternalProtocols`
 * decides whether a candidate opens.
 */
export function externalProtocolTarget(raw: string): string | null {
  let protocol: string;
  try {
    protocol = new URL(raw).protocol;
  } catch {
    return null;
  }
  const scheme = protocol.slice(0, -1);
  return NATIVE_SCHEMES.has(scheme) ? null : scheme;
}

/**
 * True for a typed `host:port` that is not a scheme: a non-special
 * scheme's URL has no `hostname`, so `tel:123` looks alike; only a dotted
 * or `localhost` word before the colon counts. Typed input only — page
 * links are unambiguous.
 */
export function looksLikeHostPort(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.hostname !== "" || !/^\d+(\/.*)?$/.test(parsed.pathname)) return false;
  const word = parsed.protocol.slice(0, -1);
  return word === "localhost" || word.includes(".");
}

/**
 * The key a decision is remembered under. `selfInitiated` separates "the
 * user typed this" from "a page asked with no nameable origin": both carry
 * `origin: null`, but an allow while typing a `mailto:` must not cover a
 * page's own opaque-origin request.
 */
function keyOf(origin: string | null, scheme: string, selfInitiated: boolean): string {
  const bucket = selfInitiated ? "self" : (origin ?? "page");
  return `${bucket} ${scheme}`;
}

interface Watcher {
  contents: PageContents;
  /**
   * Undoes the `destroyed` listener this watcher acquired, paired at the
   * point of acquisition like `Permissions`' own waiters — settling the
   * ask is one release path, the tab dying first is the other, and both
   * have to run it.
   */
  release: () => void;
}

interface PendingExternal {
  promptsId: number;
  origin: string | null;
  scheme: string;
  selfInitiated: boolean;
  /** Every URL waiting on this one decision, in case the same ask arrives twice before it settles. */
  urls: string[];
  /** Every tab that asked about this scheme, so one closing does not cancel a sibling's still-live question. */
  watchers: Watcher[];
  /**
   * A request for this ask arrived with no tab to watch — a `:tabnew` or
   * restored-session URL, tied to no tab's lifetime. `#dropWatcher` must
   * not cancel the entry because every watched tab died; this request is
   * still owed an answer.
   */
  hasUnwatchedRequest: boolean;
}

/**
 * Whether a scheme may reach `shell.openExternal`, decided per origin and
 * scheme: deny by default, ask once, keep the answer. No allowlist — site
 * picks scheme, user decides. Tab-loaded schemes never reach here. An ask
 * with nothing watching is app-scoped, like `Permissions`.
 */
export class ExternalProtocols {
  #prompts: Prompts<PromptState>;
  #open: (url: string) => void;
  #warn: (text: string) => void;
  #decisions = new Map<string, boolean>();
  #pending: PendingExternal[] = [];

  constructor(
    prompts: Prompts<PromptState>,
    open: (url: string) => void,
    warn: (text: string) => void,
  ) {
    this.#prompts = prompts;
    this.#open = open;
    this.#warn = warn;
  }

  /**
   * A recognised handed-off URL and its scheme, split out — a second parse
   * could disagree with the caller's. `origin` is the asking page or null;
   * `selfInitiated` means nothing asked; `contents` is the tab behind the
   * ask, or null.
   */
  request(
    url: string,
    scheme: string,
    origin: string | null,
    selfInitiated: boolean,
    contents: PageContents | null,
  ): void {
    const key = keyOf(origin, scheme, selfInitiated);
    const known = this.#decisions.get(key);
    if (known === true) return this.#open(url);
    if (known === false) {
      // Silence here would be indistinguishable from a broken sign-in flow:
      // the one thing worth saying is what was blocked and how to undo it.
      const site = origin === null ? "" : ` for ${new URL(origin).host}`;
      this.#warn(`${scheme}: is blocked${site} — restart kvist to ask again`);
      return;
    }

    const waiting = this.#pending.find(
      (entry) =>
        entry.origin === origin && entry.scheme === scheme && entry.selfInitiated === selfInitiated,
    );
    if (waiting !== undefined) {
      waiting.urls.push(url);
      if (contents === null) {
        waiting.hasUnwatchedRequest = true;
      } else if (!waiting.watchers.some((watcher) => watcher.contents === contents)) {
        waiting.watchers.push(this.#watch(waiting.promptsId, contents));
      }
      return;
    }

    const promptsId = this.#prompts.ask(
      { kind: "external-protocol", origin, scheme, url },
      (allow) => this.#settle(promptsId, allow),
    );
    const entry: PendingExternal = {
      promptsId,
      origin,
      scheme,
      selfInitiated,
      urls: [url],
      watchers: [],
      hasUnwatchedRequest: contents === null,
    };
    if (contents !== null) entry.watchers.push(this.#watch(promptsId, contents));
    this.#pending.push(entry);
  }

  /** Windows subscribe to the head of the prompt queue, same as Permissions. */
  observe(observer: (head: { id: number; state: PromptState } | null) => void): () => void {
    return this.#prompts.observe(observer);
  }

  /** Exposed for tests; the chrome reads the head through `observe`, never this. */
  get pending(): { id: number; state: PromptState }[] {
    return this.#pending.map((entry) => ({
      id: entry.promptsId,
      state: {
        kind: "external-protocol" as const,
        origin: entry.origin,
        scheme: entry.scheme,
        url: entry.urls[0]!,
      },
    }));
  }

  /** Test-facing passthroughs to the shared queue, same as Permissions offers. */
  answer(id: number, allow: boolean): void {
    this.#prompts.answer(id, allow);
  }

  answerHead(allow: boolean): void {
    this.#prompts.answerHead(allow);
  }

  /** Acquires the `destroyed` listener a watcher needs, paired with its release. */
  #watch(promptsId: number, contents: PageContents): Watcher {
    const onDestroyed = (): void => this.#dropWatcher(promptsId, contents);
    contents.once("destroyed", onDestroyed);
    return { contents, release: () => contents.removeListener("destroyed", onDestroyed) };
  }

  /**
   * One watcher's tab died; its wait alone ends. A sibling tab is still
   * watching; an unwatched request (`hasUnwatchedRequest`) still needs an
   * answer. With neither left, the prompt is removed unanswered — nobody
   * decided, nothing remembered.
   */
  #dropWatcher(promptsId: number, contents: PageContents): void {
    const entry = this.#pending.find((candidate) => candidate.promptsId === promptsId);
    if (entry === undefined) return;

    entry.watchers = entry.watchers.filter((watcher) => watcher.contents !== contents);
    if (entry.watchers.length > 0 || entry.hasUnwatchedRequest) return;

    this.#pending = this.#pending.filter((candidate) => candidate.promptsId !== promptsId);
    this.#prompts.cancel(promptsId);
  }

  #settle(promptsId: number, allow: boolean): void {
    const index = this.#pending.findIndex((entry) => entry.promptsId === promptsId);
    if (index === -1) return;
    const [entry] = this.#pending.splice(index, 1);

    for (const watcher of entry.watchers) watcher.release();
    this.#decisions.set(keyOf(entry.origin, entry.scheme, entry.selfInitiated), allow);
    if (allow) for (const url of entry.urls) this.#open(url);
  }
}
