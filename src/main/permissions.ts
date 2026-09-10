import type { Session, WebContents } from "electron";
import type { PromptablePermission, PromptState } from "../shared/ipc";
import { httpOrigin } from "../shared/url";
import { Prompts } from "./prompts";

/**
 * The head of the prompts queue as the IPC channel expects it: `{id, state}`.
 * Permissions' state carries no id (the queue owns it), so the sender passes
 * the pair through.
 */
type PromptHead = { id: number; state: PromptState };

/**
 * What a permission gets without asking. `grant` covers what Chrome grants
 * silently — denying fullscreen or pointer lock breaks video and games, and
 * denying sanitized writes breaks "copy link". Everything else is denied:
 * Electron's grant-everything default is what this class ends.
 */
const GRANT = new Set(["fullscreen", "pointerLock", "clipboard-sanitized-write"]);
const ASK = new Set<string>(["media", "geolocation", "notifications", "clipboard-read"]);

type Ruling = "grant" | "ask" | "deny";

function policy(permission: string): Ruling {
  if (GRANT.has(permission)) return "grant";
  if (ASK.has(permission)) return "ask";
  return "deny";
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
   * Undoes the `destroyed` listener for this waiter, paired at acquisition
   * like the downloads' `updated`/`done` pair — a tab asking many questions
   * across a session must not collect dead listeners.
   */
  release: () => void;
}

/**
 * A coalesced entry: one prompt for the chrome, plus every waiting
 * webContents. `promptsId` is what `Prompts` stamped on the entry's state,
 * and what `prompts.cancel` needs if every waiter vanishes.
 */
interface PendingRequest {
  promptsId: number;
  origin: string;
  permission: PromptablePermission;
  mediaTypes?: ("video" | "audio")[];
  waiters: Waiter[];
}

/**
 * The permission policy over the shared prompt queue, session-scoped:
 * attached once at app level; windows subscribe. Answers are remembered
 * per origin, both ways, or a denied site re-asks every click. `Prompts`
 * owns the queue; this class owns coalescing, decisions, waiters.
 */
export class Permissions {
  #prompts: Prompts<PromptState>;
  #decisions = new Map<string, boolean>();
  /** Active coalesced entries, keyed by the tuple Permissions merges on. */
  #pending: PendingRequest[] = [];

  /**
   * The queue is shared with the app — the session-restore ask uses the
   * same `Prompts`, so permission prompts and the restore ask reach one
   * observer and one chrome line. Permissions owns only the policy on top.
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
   * A camera grant must not cover the microphone, or the reverse: each
   * requested device kind is checked — and remembered — on its own. Only
   * when every kind is already known does the prompt get skipped outright.
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
   * A second request for an in-flight ask joins the wait rather than
   * stacking a prompt the user already read — matched on exact device
   * kinds, so a camera-only ask and a combined one do not merge into the
   * wrong question.
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
   * A tab dying with its question open is no denial — nobody answered, so
   * the decision stays. Only that wait ends; a coalesced sibling keeps
   * waiting, and once no waiters remain the prompt is removed without
   * firing — the queue's `cancel`.
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
