import type { Session, WebContents } from "electron";
import type { PermissionPromptState, PromptablePermission } from "../shared/ipc";

/**
 * What a permission gets without anyone being asked. `grant` is for what
 * Chrome also grants silently — denying fullscreen or pointer lock breaks
 * video players and games, and denying sanitized writes breaks every "copy
 * link" button. Everything not listed is denied: Electron's default is to
 * grant all of it without a word, which is the thing this class exists to end.
 */
const GRANT = new Set(["fullscreen", "pointerLock", "clipboard-sanitized-write"]);
const ASK = new Set<string>(["media", "geolocation", "notifications", "clipboard-read"]);

type Ruling = "grant" | "ask" | "deny";

function policy(permission: string): Ruling {
  if (GRANT.has(permission)) return "grant";
  if (ASK.has(permission)) return "ask";
  return "deny";
}

/**
 * The key a decision is remembered under. Only http(s) origins may be asked
 * about: `kvist:` pages, `file:`, devtools and anything opaque all parse to
 * the origin "null", and a prompt that cannot say who is asking is no prompt.
 */
function httpOrigin(url: string): string | null {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return null;
  }
  return origin.startsWith("http://") || origin.startsWith("https://") ? origin : null;
}

function keyOf(origin: string, permission: string): string {
  // Origins never contain a space, so the pair cannot collide with another.
  return `${origin} ${permission}`;
}

/** What the session handler needs to say about a request, adapted off Electron's union. */
export interface PermissionRequestDetails {
  requestingUrl: string;
  mediaTypes?: ("video" | "audio")[];
}

interface PendingRequest {
  id: number;
  origin: string;
  permission: PromptablePermission;
  mediaTypes?: ("video" | "audio")[];
  contents: WebContents;
  /** One per waiting caller: a repeated request joins the prompt already up. */
  callbacks: ((granted: boolean) => void)[];
}

function toState(entry: PendingRequest): PermissionPromptState {
  const { id, origin, permission, mediaTypes } = entry;
  return { id, origin, permission, mediaTypes };
}

/**
 * The permission policy and the prompt queue. Session-scoped like the
 * downloads: a page's camera grant is no window's business, and the session
 * allows only one request handler, so this is attached once by the app and
 * windows subscribe.
 *
 * Answers are remembered per origin for the session — both ways, or a denied
 * site would re-ask on every click. Persistence is Phase 6's to add; until
 * then a restart is how a decision is revoked.
 */
export class Permissions {
  #decisions = new Map<string, boolean>();
  #pending: PendingRequest[] = [];
  #observers = new Set<(pending: PermissionPromptState[]) => void>();
  #nextId = 1;

  /**
   * Both handlers, or the two answer inconsistently: the check handler fields
   * the synchronous probes (`navigator.permissions.query`, device labels)
   * that would otherwise keep Electron's grant-everything default.
   */
  attach(session: Session): void {
    session.setPermissionRequestHandler((contents, permission, callback, details) => {
      this.request(contents, permission, callback, {
        requestingUrl: details.requestingUrl,
        mediaTypes: "mediaTypes" in details ? details.mediaTypes : undefined,
      });
    });
    session.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
      this.check(permission, requestingOrigin),
    );
  }

  /** Windows subscribe; a full snapshot, never a diff. */
  observe(observer: (pending: PermissionPromptState[]) => void): () => void {
    this.#observers.add(observer);
    return () => void this.#observers.delete(observer);
  }

  /** The queue as it stands, for a window that finished loading after it formed. */
  get pending(): PermissionPromptState[] {
    return this.#pending.map(toState);
  }

  /**
   * The synchronous probe. There is no "prompt" answer here, only granted or
   * not, so an unknown origin reads as denied — a site that wants the
   * permission then makes the request, which is where the asking happens.
   */
  check(permission: string, requestingOrigin: string): boolean {
    const ruling = policy(permission);
    if (ruling === "grant") return true;
    if (ruling === "deny") return false;

    const origin = httpOrigin(requestingOrigin);
    if (origin === null) return false;
    return this.#decisions.get(keyOf(origin, permission)) ?? false;
  }

  /** The asynchronous request: rule, remember, or queue a prompt. */
  request(
    contents: WebContents,
    permission: string,
    callback: (granted: boolean) => void,
    details: PermissionRequestDetails,
  ): void {
    const ruling = policy(permission);
    if (ruling === "grant") return callback(true);
    if (ruling === "deny") return callback(false);

    const origin = httpOrigin(details.requestingUrl);
    if (origin === null) return callback(false);

    const known = this.#decisions.get(keyOf(origin, permission));
    if (known !== undefined) return callback(known);

    // A second request for what is already being asked joins the wait rather
    // than stacking a prompt the user has already read.
    const waiting = this.#pending.find(
      (entry) => entry.origin === origin && entry.permission === permission,
    );
    if (waiting !== undefined) {
      waiting.callbacks.push(callback);
      return;
    }

    const entry: PendingRequest = {
      id: this.#nextId++,
      origin,
      // SAFETY: ruling === "ask" is exactly the PromptablePermission set.
      permission: permission as PromptablePermission,
      mediaTypes: details.mediaTypes,
      contents,
      callbacks: [callback],
    };
    this.#pending.push(entry);
    // A tab that dies with its question unanswered is a denial, but not one
    // to remember: nobody answered anything.
    contents.once("destroyed", () => this.#settle(entry.id, false, false));
    this.#notify();
  }

  /** The chrome answering the prompt it is showing; a stale id is a no-op. */
  answer(id: number, allow: boolean): void {
    this.#settle(id, allow, true);
  }

  /** A y or an n from the mode machine, which answers whatever is up. */
  answerHead(allow: boolean): void {
    const head = this.#pending[0];
    if (head !== undefined) this.#settle(head.id, allow, true);
  }

  #settle(id: number, allow: boolean, remember: boolean): void {
    const index = this.#pending.findIndex((entry) => entry.id === id);
    if (index === -1) return;
    const [entry] = this.#pending.splice(index, 1);
    if (remember) this.#decisions.set(keyOf(entry.origin, entry.permission), allow);
    // Calling Chromium's callback into a destroyed contents is the one way
    // this can throw, and the dead tab no longer cares about the answer.
    if (!entry.contents.isDestroyed()) {
      for (const callback of entry.callbacks) callback(allow);
    }
    this.#notify();
  }

  #notify(): void {
    const snapshot = this.pending;
    for (const observer of this.#observers) observer(snapshot);
  }
}
