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

function keyOf(origin: string, permission: string, mediaType?: "video" | "audio"): string {
  // Origins never contain a space, so the pair (or triple, for a specific
  // device kind) cannot collide with another.
  return mediaType === undefined
    ? `${origin} ${permission}`
    : `${origin} ${permission}:${mediaType}`;
}

/** Whether two coalescing requests are asking about the same thing. */
function sameMediaTypes(
  a: ("video" | "audio")[] | undefined,
  b: ("video" | "audio")[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((type, index) => type === sortedB[index]);
}

/** What the session handler needs to say about a request, adapted off Electron's union. */
export interface PermissionRequestDetails {
  requestingUrl: string;
  mediaTypes?: ("video" | "audio")[];
}

interface Waiter {
  contents: WebContents;
  callback: (granted: boolean) => void;
}

interface PendingRequest {
  id: number;
  origin: string;
  permission: PromptablePermission;
  mediaTypes?: ("video" | "audio")[];
  /**
   * One per tab asking about the same question, tracked with its own
   * webContents: two tabs on one origin can both ask, and one of them
   * closing must not strand the other's callback unanswered.
   */
  waiters: Waiter[];
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
    session.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) =>
      this.check(permission, requestingOrigin, details.mediaType),
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
  check(
    permission: string,
    requestingOrigin: string,
    mediaType?: "video" | "audio" | "unknown",
  ): boolean {
    const ruling = policy(permission);
    if (ruling === "grant") return true;
    if (ruling === "deny") return false;

    const origin = httpOrigin(requestingOrigin);
    if (origin === null) return false;

    if (permission === "media") {
      // The camera and the microphone are remembered separately; a check that
      // cannot say which one is meant cannot be answered from that memory.
      if (mediaType !== "video" && mediaType !== "audio") return false;
      return this.#decisions.get(keyOf(origin, permission, mediaType)) ?? false;
    }

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

    if (permission === "media") {
      this.#requestMedia(contents, callback, origin, details.mediaTypes);
      return;
    }

    const known = this.#decisions.get(keyOf(origin, permission));
    if (known !== undefined) return callback(known);

    // SAFETY: ruling === "ask" here is exactly the PromptablePermission set.
    this.#queue(contents, callback, origin, permission as PromptablePermission, undefined);
  }

  /**
   * A camera grant must not silently cover the microphone too, and the other
   * way round: each device kind the request names is checked — and later
   * remembered — on its own. Only once every kind asked about is already
   * known can this skip the prompt outright.
   */
  #requestMedia(
    contents: WebContents,
    callback: (granted: boolean) => void,
    origin: string,
    mediaTypes: ("video" | "audio")[] | undefined,
  ): void {
    const types: ("video" | "audio")[] =
      mediaTypes && mediaTypes.length > 0 ? mediaTypes : ["video", "audio"];
    const remembered = types.map((type) => this.#decisions.get(keyOf(origin, "media", type)));

    // A device kind already refused stays refused.
    if (remembered.some((decision) => decision === false)) return callback(false);
    // Every kind this request names has already been allowed.
    if (remembered.every((decision) => decision === true)) return callback(true);

    this.#queue(contents, callback, origin, "media", types);
  }

  /**
   * A second request for what is already being asked joins the wait rather
   * than stacking a prompt the user has already read — matched on the exact
   * device kinds too, so a camera-only ask and a combined ask do not merge
   * into the wrong question.
   */
  #queue(
    contents: WebContents,
    callback: (granted: boolean) => void,
    origin: string,
    permission: PromptablePermission,
    mediaTypes: ("video" | "audio")[] | undefined,
  ): void {
    const waiting = this.#pending.find(
      (entry) =>
        entry.origin === origin &&
        entry.permission === permission &&
        sameMediaTypes(entry.mediaTypes, mediaTypes),
    );
    if (waiting !== undefined) {
      waiting.waiters.push({ contents, callback });
      contents.once("destroyed", () => this.#dropWaiter(waiting.id, contents));
      return;
    }

    const entry: PendingRequest = {
      id: this.#nextId++,
      origin,
      permission,
      mediaTypes,
      waiters: [{ contents, callback }],
    };
    this.#pending.push(entry);
    contents.once("destroyed", () => this.#dropWaiter(entry.id, contents));
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

    if (remember) {
      if (entry.permission === "media" && entry.mediaTypes) {
        for (const type of entry.mediaTypes)
          this.#decisions.set(keyOf(entry.origin, "media", type), allow);
      } else {
        this.#decisions.set(keyOf(entry.origin, entry.permission), allow);
      }
    }

    // Calling Chromium's callback into a destroyed contents is the one way
    // this can throw, and that tab no longer cares about the answer — but a
    // second tab waiting on the same question is still owed its callback.
    for (const waiter of entry.waiters) {
      if (!waiter.contents.isDestroyed()) waiter.callback(allow);
    }
    this.#notify();
  }

  /**
   * A tab that dies with its question unanswered is a denial, but not one to
   * remember: nobody answered anything. Only that tab's own wait ends here —
   * a second tab that coalesced onto the same question is still waiting, and
   * the prompt stays up until every waiter is gone.
   */
  #dropWaiter(id: number, contents: WebContents): void {
    const entry = this.#pending.find((candidate) => candidate.id === id);
    if (entry === undefined) return;

    entry.waiters = entry.waiters.filter((waiter) => waiter.contents !== contents);
    if (entry.waiters.length > 0) return;

    this.#pending = this.#pending.filter((candidate) => candidate.id !== id);
    this.#notify();
  }

  #notify(): void {
    const snapshot = this.pending;
    for (const observer of this.#observers) observer(snapshot);
  }
}
