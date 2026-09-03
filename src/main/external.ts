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

/** The key a decision is remembered under, scoped to no origin when none asked. */
function keyOf(origin: string | null, scheme: string): string {
  return `${origin ?? ""} ${scheme}`;
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
  /** Every URL waiting on this one decision, in case the same ask arrives twice before it settles. */
  urls: string[];
  /** Every tab that asked about this scheme, so one closing does not cancel a sibling's still-live question. */
  watchers: Watcher[];
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
 */
export class ExternalProtocols {
  #prompts: Prompts<PromptState>;
  #open: (url: string) => void;
  #decisions = new Map<string, boolean>();
  #pending: PendingExternal[] = [];

  constructor(prompts: Prompts<PromptState>, open: (url: string) => void) {
    this.#prompts = prompts;
    this.#open = open;
  }

  /**
   * A URL kvist has already recognised as a scheme it does not load itself.
   * `origin` is the page that asked, or null for the user's own action
   * (typed in the omnibox, `:tabnew`, a restored tab). `contents` is the
   * tab behind the ask, or null when nothing was created for it (session
   * restore, the default homepage) — every tab watching a still-pending
   * ask closing is what cancels it, so a second window does not inherit a
   * question about a page that is gone.
   */
  request(url: string, scheme: string, origin: string | null, contents: PageContents | null): void {
    const key = keyOf(origin, scheme);
    const known = this.#decisions.get(key);
    if (known === true) return this.#open(url);
    if (known === false) return;

    const waiting = this.#pending.find(
      (entry) => entry.origin === origin && entry.scheme === scheme,
    );
    if (waiting !== undefined) {
      waiting.urls.push(url);
      if (contents !== null && !waiting.watchers.some((watcher) => watcher.contents === contents)) {
        waiting.watchers.push(this.#watch(waiting.promptsId, contents));
      }
      return;
    }

    const promptsId = this.#prompts.ask({ kind: "external-protocol", origin, scheme }, (allow) =>
      this.#settle(promptsId, allow),
    );
    const entry: PendingExternal = { promptsId, origin, scheme, urls: [url], watchers: [] };
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
      state: { kind: "external-protocol" as const, origin: entry.origin, scheme: entry.scheme },
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
   * scheme is still watching, and the prompt stays up until every watcher
   * is gone. With none left the prompt is removed without answering it:
   * nobody decided, so nothing is remembered either.
   */
  #dropWatcher(promptsId: number, contents: PageContents): void {
    const entry = this.#pending.find((candidate) => candidate.promptsId === promptsId);
    if (entry === undefined) return;

    entry.watchers = entry.watchers.filter((watcher) => watcher.contents !== contents);
    if (entry.watchers.length > 0) return;

    this.#pending = this.#pending.filter((candidate) => candidate.promptsId !== promptsId);
    this.#prompts.cancel(promptsId);
  }

  #settle(promptsId: number, allow: boolean): void {
    const index = this.#pending.findIndex((entry) => entry.promptsId === promptsId);
    if (index === -1) return;
    const [entry] = this.#pending.splice(index, 1);

    for (const watcher of entry.watchers) watcher.release();
    this.#decisions.set(keyOf(entry.origin, entry.scheme), allow);
    if (allow) for (const url of entry.urls) this.#open(url);
  }
}
