import type { PromptState } from "../shared/ipc";
import type { PageContents } from "./page-host";
import type { Prompts } from "./prompts";

/**
 * Schemes Chromium already loads inside a tab, one way or another — either
 * genuinely (`http`, `https`, `kvist`, `file`) or by design, failing the
 * navigation itself (`about`, `chrome`, `devtools`, ...). None of these are
 * ever a candidate for the OS to open instead: asking to hand `file:` to
 * the desktop would be new, wrong behaviour for a path that already works
 * (or already fails the same way it always has).
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
 * The scheme of a URL the desktop should open instead of the tab, or null
 * for a scheme this browser loads itself. Everything else is a candidate —
 * not just a fixed handful of known ones — because there is no way to
 * enumerate every native-app scheme a site might hand off to in advance;
 * `ExternalProtocols` is what decides whether a candidate is actually
 * opened.
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
 * Whether a URL is structurally indistinguishable from a typed `host:port`
 * — `localhost:3000`, `example.com:8080` — rather than a real scheme
 * invocation. Any bare word followed by `:` parses as a valid, if unusual,
 * scheme (`resolveUrl`'s `HAS_SCHEME` regex already treats it as "already a
 * URL"), and a non-special scheme's own URL has no `hostname` either way —
 * so a typed dev-server address parses exactly like a real external scheme
 * would, opaque path and all.
 *
 * Only ever call this for input that was not authored by a page: a page's
 * own `<a href>` is never ambiguous, but a person typing into the omnibox
 * (or `:tabnew`/`:open`) might mean either one. The one accepted false
 * positive is a domestic-format `tel:` number typed directly into the
 * omnibox (`tel:0701234567`, all digits, no `+`) — rare next to how common
 * typing a bare `host:port` to reach a local dev server is, and a page's
 * own `tel:` links (the common case) never go through this check at all.
 */
export function looksLikeHostPort(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  return parsed.hostname === "" && /^\d+(\/.*)?$/.test(parsed.pathname);
}

/**
 * The key a decision is remembered under. `selfInitiated` keeps "the user
 * typed this" and "a page asked but named no nameable origin" from sharing
 * a bucket: both carry `origin: null`, but they are different levels of
 * trust — an allow the user granted while typing a `mailto:` must not
 * silently cover a `kvist:`/`file:`/opaque-origin page's own request for
 * the same scheme.
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
   * Set once any request for this ask arrived with no tab to watch — a
   * `:tabnew` or session-restore URL that has nothing tied to a tab's
   * lifetime. `#dropWatcher` must not cancel the whole entry just because
   * every *watched* request's tab died; this one is still owed an answer.
   */
  hasUnwatchedRequest: boolean;
}

/**
 * Whether a scheme the desktop, not a tab, should handle may actually reach
 * `shell.openExternal`. Same shape as `Permissions`: deny by default, ask
 * once, remember the answer per origin and scheme for the session — a site
 * that hands off to `bankid:` on every sign-in must not re-prompt on every
 * click, and a user who says no once should not be asked again either.
 *
 * There is no fixed allowlist of schemes here on purpose: the site decides
 * what it wants opened, the user decides whether that is answered — the
 * same trade Permissions already makes for the camera and geolocation
 * instead of Electron's grant-everything default. A scheme the browser
 * loads itself never reaches here at all; `externalProtocolTarget` filters
 * those out before a request is made.
 *
 * An ask with nothing watching it (`:tabnew mailto:x`, a saved session row,
 * the default homepage) is app-scoped like `Permissions`' own decisions:
 * there is no tab to tie its lifetime to, so it survives whatever window
 * asked closing, the same deliberate exception `Downloads` and
 * `Permissions` already are. A prompt with at least one watched tab is not
 * — closing every tab that asked about it does cancel it.
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
   * A URL kvist has already recognised as a scheme it does not load itself,
   * with its scheme already split out (recomputing it here, from the same
   * URL, would just be a second parse that could disagree with the
   * caller's). `origin` is the page that asked, or null when it named
   * nothing nameable; `selfInitiated` is true when nothing asked on a
   * page's behalf at all (typed in the omnibox, `:tabnew`, a restored
   * tab) — see `keyOf`. `contents` is the tab behind the ask, or null when
   * nothing was created for it.
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
   * The tab behind one of a pending ask's watchers has died. Only that
   * watcher's own wait ends here — a sibling tab that asked about the same
   * scheme is still watching, and an unwatched request riding along
   * (`hasUnwatchedRequest`) is still owed an answer regardless. With no
   * watchers left and nothing unwatched, the prompt is removed without
   * answering it: nobody decided, so nothing is remembered either.
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
