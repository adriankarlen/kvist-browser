import type { Session, WebContents } from "electron";
import type { PromptablePermission, PromptState } from "../shared/ipc";
import { Prompts } from "./prompts";

/**
 * The head of the prompts queue, formatted the way the IPC channel expects
 * it: a flat pair of id and state. Permissions' state carries no id of its
 * own (the queue owns it), so `head` here is `{id, state}` and the IPC
 * sender just passes it through.
 */
type PromptHead = { id: number; state: PromptState };

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
  /**
   * Undoes the `destroyed` listener acquired for this waiter. Paired at the
   * point of acquisition, same as the downloads' `updated`/`done` pair — a
   * tab that keeps asking for permissions across a long session must not
   * accumulate one dead listener per question it already got an answer to.
   */
  release: () => void;
}

/**
 * A coalesced entry: one prompt for the chrome to show, plus every
 * webContents waiting on its answer. The `promptsId` is what `Prompts`
 * generated for the entry's IPC state, and what `prompts.cancel(...)`
 * needs if every waiter goes away before the user answers.
 */
interface PendingRequest {
  promptsId: number;
  origin: string;
  permission: PromptablePermission;
  mediaTypes?: ("video" | "audio")[];
  waiters: Waiter[];
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
 *
 * The queue, observer, and answer mechanics live in `Prompts`. This class
 * keeps only the policy: coalescing matches, per-origin decisions, and the
 * waiter list whose lifecycle is owned by Chromium (a destroyed tab must
 * not strand a callback).
 */
export class Permissions {
  #prompts: Prompts<PromptState>;
  #decisions = new Map<string, boolean>();
  /** Active coalesced entries, keyed by the tuple Permissions merges on. */
  #pending: PendingRequest[] = [];

  /**
   * The queue is shared with the rest of the app — the session-restore ask
   * uses the same `Prompts<PromptState>`, so permission prompts and the
   * restore ask reach one observer and one chrome line. Permissions owns
   * nothing about the queue's lifecycle; it only owns the policy on top.
   */
  constructor(prompts: Prompts<PromptState>) {
    this.#prompts = prompts;
  }

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

  /**
   * Windows subscribe to the head of the prompt queue. The full-snapshot
   * shape Permissions used to ship was load-bearing for nothing — the
   * chrome renders one prompt line at a time, so the head is enough.
   */
  observe(observer: (head: PromptHead | null) => void): () => void {
    return this.#prompts.observe(observer);
  }

  /**
   * The coalesced permission entries, in queue order. Exposed for tests and
   * diagnostics — the chrome reads the head through `observe`, never this.
   * Each entry's id matches what `Prompts` generated for the IPC state.
   */
  get pending(): PromptHead[] {
    return this.#pending.map((entry) => ({
      id: entry.promptsId,
      state: {
        kind: "permission" as const,
        origin: entry.origin,
        permission: entry.permission,
        mediaTypes: entry.mediaTypes,
      },
    }));
  }

  /** The synchronous probe. There is no "prompt" answer here, only granted or
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

    // Only the kinds still unknown are actually in question. Queuing the
    // full combination here would let answering it re-decide a kind that was
    // already granted on its own — denying "camera and microphone" when the
    // camera was only riding along must not revoke that earlier grant.
    const unresolved = types.filter(
      (type) => this.#decisions.get(keyOf(origin, "media", type)) === undefined,
    );
    this.#queue(contents, callback, origin, "media", unresolved);
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
      waiting.waiters.push(this.#waiterFor(waiting.promptsId, contents, callback));
      return;
    }

    const promptsId = this.#prompts.ask(
      { kind: "permission", origin, permission, mediaTypes },
      (allow) => this.#settle(promptsId, allow),
    );
    const entry: PendingRequest = { promptsId, origin, permission, mediaTypes, waiters: [] };
    entry.waiters.push(this.#waiterFor(promptsId, contents, callback));
    this.#pending.push(entry);
  }

  /** Acquires the `destroyed` listener a waiter needs, paired with its release. */
  #waiterFor(
    promptsId: number,
    contents: WebContents,
    callback: (granted: boolean) => void,
  ): Waiter {
    const onDestroyed = (): void => this.#dropWaiter(promptsId, contents);
    contents.once("destroyed", onDestroyed);
    return { contents, callback, release: () => contents.removeListener("destroyed", onDestroyed) };
  }

  /** The chrome answering the prompt it is showing; a stale id is a no-op. */
  answer(id: number, allow: boolean): void {
    this.#prompts.answer(id, allow);
  }

  /** A y or an n from the mode machine, which answers whatever is up. */
  answerHead(allow: boolean): void {
    this.#prompts.answerHead(allow);
  }

  #settle(promptsId: number, allow: boolean): void {
    const index = this.#pending.findIndex((entry) => entry.promptsId === promptsId);
    if (index === -1) return;
    const [entry] = this.#pending.splice(index, 1);

    if (entry.permission === "media" && entry.mediaTypes) {
      for (const type of entry.mediaTypes)
        this.#decisions.set(keyOf(entry.origin, "media", type), allow);
    } else {
      this.#decisions.set(keyOf(entry.origin, entry.permission), allow);
    }

    // Calling Chromium's callback into a destroyed contents is the one way
    // this can throw, and that tab no longer cares about the answer — but a
    // second tab waiting on the same question is still owed its callback.
    // The listener each waiter acquired is released here too: the question is
    // answered now, so there is nothing left for it to watch for.
    for (const waiter of entry.waiters) {
      waiter.release();
      if (!waiter.contents.isDestroyed()) waiter.callback(allow);
    }
  }

  /**
   * A tab that dies with its question unanswered is not a denial: nobody
   * answered anything, so the per-origin decision stays untouched. Only
   * that tab's own wait ends here — a second tab that coalesced onto the
   * same question is still waiting, and the prompt stays up until every
   * waiter is gone. With no waiters left the prompt is removed without
   * firing its callback, which is `cancel` on the queue.
   */
  #dropWaiter(promptsId: number, contents: WebContents): void {
    const entry = this.#pending.find((candidate) => candidate.promptsId === promptsId);
    if (entry === undefined) return;

    entry.waiters = entry.waiters.filter((waiter) => waiter.contents !== contents);
    if (entry.waiters.length > 0) return;

    this.#pending = this.#pending.filter((candidate) => candidate.promptsId !== promptsId);
    this.#prompts.cancel(promptsId);
  }
}
