import { Schema } from "effect";
import {
  PromptablePermission,
  type PromptState,
  type PromptWire,
} from "../../../shared/schema/prompts";
import { next, type Next } from "../../../shared/tea/program";
import { warn } from "../messages/messages.program";
import type { Msg as MessagesMsg } from "../messages/messages.program";
import { type Msg as VimMsg, Msg as VimMsgs } from "../vim/vim.program";

const MediaType = Schema.Literals(["video", "audio"]);

type MediaType = typeof MediaType.Type;

/**
 * Who is waiting on a question, by request id. The Electron continuations
 * behind the ids live in the `Requesters` service; the model only counts
 * who is still there.
 */
type Pending =
  | {
      readonly kind: "permission";
      readonly id: number;
      readonly origin: string;
      readonly permission: PromptablePermission;
      readonly mediaTypes: ReadonlyArray<MediaType> | undefined;
      readonly requesters: ReadonlyArray<number>;
    }
  | {
      readonly kind: "external-protocol";
      readonly id: number;
      readonly origin: string | null;
      readonly scheme: string;
      readonly selfInitiated: boolean;
      readonly urls: ReadonlyArray<string>;
      readonly requesters: ReadonlyArray<number>;
      /** A request no tab made (typed URL, `:tabnew`, restored tab); nothing can retire it. */
      readonly unwatched: boolean;
    }
  | { readonly kind: "session-restore"; readonly id: number; readonly tabCount: number };

/**
 * One FIFO queue of questions, shown one at a time. Answers are remembered
 * per origin in memory, so a second ask from the same site is settled
 * without asking again.
 */
export interface Model {
  readonly queue: ReadonlyArray<Pending>;
  readonly nextId: number;
  readonly permissions: ReadonlyMap<string, boolean>;
  readonly externals: ReadonlyMap<string, boolean>;
}

export const init: Model = {
  queue: [],
  nextId: 1,
  permissions: new Map(),
  externals: new Map(),
};

export const Msg = Schema.TaggedUnion({
  /** A page asked for a permission nobody has answered for this origin yet. */
  PermissionRequested: {
    requester: Schema.Int,
    origin: Schema.String,
    permission: PromptablePermission,
    mediaTypes: Schema.UndefinedOr(Schema.Array(MediaType)),
  },
  ExternalProtocolRequested: {
    requester: Schema.Int,
    url: Schema.String,
    scheme: Schema.String,
    origin: Schema.NullOr(Schema.String),
    selfInitiated: Schema.Boolean,
    watched: Schema.Boolean,
  },
  SessionRestoreAsked: { tabCount: Schema.Int },
  /** A window closed mid-prompt: that is not a decision, so the saved session must survive. */
  SessionRestoreAbandoned: {},
  PromptAnswered: { id: Schema.Int, allow: Schema.Boolean },
  /** `y`, `n` or Escape: whatever is up, without the chrome naming an id. */
  HeadAnswered: { allow: Schema.Boolean },
  /** The tab behind a request is gone; its wait alone ends. */
  RequesterGone: { requester: Schema.Int },
});

export type Msg = typeof Msg.Type;

export const Cmd = Schema.TaggedUnion({
  SettleRequesters: { requesters: Schema.Array(Schema.Int), allow: Schema.Boolean },
  OpenExternal: { url: Schema.String },
  SessionRestoreDecided: { allow: Schema.Boolean },
});

export type Cmd = typeof Cmd.Type;

type Result = Next<Model, Msg | MessagesMsg | VimMsg, Cmd>;

export function permissionKey(origin: string, permission: string, mediaType?: MediaType): string {
  return mediaType === undefined
    ? `${origin} ${permission}`
    : `${origin} ${permission}:${mediaType}`;
}

export function externalKey(origin: string | null, scheme: string, selfInitiated: boolean): string {
  return `${selfInitiated ? "self" : (origin ?? "page")} ${scheme}`;
}

function sameTypes(
  a: ReadonlyArray<MediaType> | undefined,
  b: ReadonlyArray<MediaType> | undefined,
) {
  if (a === undefined || b === undefined) return a === b;

  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

const enqueue = (model: Model, entry: Pending): Model => ({
  ...model,
  queue: [...model.queue, entry],
  nextId: model.nextId + 1,
});

const replace = (model: Model, entry: Pending): Model => ({
  ...model,
  queue: model.queue.map((candidate) => (candidate.id === entry.id ? entry : candidate)),
});

const without = (model: Model, id: number): Model => ({
  ...model,
  queue: model.queue.filter((entry) => entry.id !== id),
});

function requestPermission(
  model: Model,
  msg: Extract<Msg, { _tag: "PermissionRequested" }>,
): Result {
  const { requester, origin, permission, mediaTypes } = msg;

  const waiting = model.queue.find(
    (entry) =>
      entry.kind === "permission" &&
      entry.origin === origin &&
      entry.permission === permission &&
      sameTypes(entry.mediaTypes, mediaTypes),
  );

  if (waiting?.kind === "permission") {
    return next(replace(model, { ...waiting, requesters: [...waiting.requesters, requester] }));
  }

  return next(
    enqueue(model, {
      kind: "permission",
      id: model.nextId,
      origin,
      permission,
      mediaTypes,
      requesters: [requester],
    }),
  );
}

function requestExternal(
  model: Model,
  msg: Extract<Msg, { _tag: "ExternalProtocolRequested" }>,
): Result {
  const { requester, url, scheme, origin, selfInitiated, watched } = msg;
  const known = model.externals.get(externalKey(origin, scheme, selfInitiated));

  if (known === true) return next(model, [Cmd.cases.OpenExternal.make({ url })]);

  if (known === false) {
    const site = origin === null ? "" : ` for ${new URL(origin).host}`;

    return next(model, [], [warn(`${scheme}: is blocked${site} — restart kvist to ask again`)]);
  }

  const waiting = model.queue.find(
    (entry) =>
      entry.kind === "external-protocol" &&
      entry.origin === origin &&
      entry.scheme === scheme &&
      entry.selfInitiated === selfInitiated,
  );

  if (waiting?.kind === "external-protocol") {
    return next(
      replace(model, {
        ...waiting,
        urls: [...waiting.urls, url],
        requesters: watched ? [...waiting.requesters, requester] : waiting.requesters,
        unwatched: waiting.unwatched || !watched,
      }),
    );
  }

  return next(
    enqueue(model, {
      kind: "external-protocol",
      id: model.nextId,
      origin,
      scheme,
      selfInitiated,
      urls: [url],
      requesters: watched ? [requester] : [],
      unwatched: !watched,
    }),
  );
}

function answer(model: Model, id: number, allow: boolean): Result {
  const entry = model.queue.find((candidate) => candidate.id === id);

  // A stale id: the click that lost the race against a cancel settles nothing.
  if (entry === undefined) return next(model);
  const rest = without(model, id);

  switch (entry.kind) {
    case "permission": {
      const permissions = new Map(model.permissions);

      if (entry.permission === "media" && entry.mediaTypes !== undefined) {
        for (const type of entry.mediaTypes) {
          permissions.set(permissionKey(entry.origin, "media", type), allow);
        }
      } else {
        permissions.set(permissionKey(entry.origin, entry.permission), allow);
      }

      return next({ ...rest, permissions }, [
        Cmd.cases.SettleRequesters.make({ requesters: entry.requesters, allow }),
      ]);
    }

    case "external-protocol": {
      const externals = new Map(model.externals);

      externals.set(externalKey(entry.origin, entry.scheme, entry.selfInitiated), allow);
      const opens = allow ? entry.urls.map((url) => Cmd.cases.OpenExternal.make({ url })) : [];

      return next({ ...rest, externals }, [
        Cmd.cases.SettleRequesters.make({ requesters: entry.requesters, allow }),
        ...opens,
      ]);
    }

    case "session-restore":
      return next(rest, [Cmd.cases.SessionRestoreDecided.make({ allow })]);
  }
}

/** One requester gone. With nobody left waiting, the prompt goes unanswered: nothing is remembered. */
function requesterGone(model: Model, requester: number): Result {
  const entry = model.queue.find(
    (candidate) => candidate.kind !== "session-restore" && candidate.requesters.includes(requester),
  );

  if (entry === undefined || entry.kind === "session-restore") return next(model);
  const requesters = entry.requesters.filter((id) => id !== requester);

  const abandoned =
    requesters.length === 0 && !(entry.kind === "external-protocol" && entry.unwatched);

  return next(abandoned ? without(model, entry.id) : replace(model, { ...entry, requesters }));
}

/** A question appearing or the last one going captures or frees normal mode. */
export function update(msg: Msg, model: Model): Result {
  const result = handle(msg, model);
  const pending = result.model.queue.length > 0;

  if (pending === model.queue.length > 0) return result;

  return next(result.model, result.cmds, [
    ...result.msgs,
    VimMsgs.cases.PromptPendingChanged.make({ pending }),
  ]);
}

function handle(msg: Msg, model: Model): Result {
  return Msg.match(msg, {
    PermissionRequested: (request) => requestPermission(model, request),
    ExternalProtocolRequested: (request) => requestExternal(model, request),
    SessionRestoreAsked: ({ tabCount }) =>
      next(enqueue(model, { kind: "session-restore", id: model.nextId, tabCount })),
    SessionRestoreAbandoned: () =>
      next({ ...model, queue: model.queue.filter((entry) => entry.kind !== "session-restore") }),
    PromptAnswered: ({ id, allow }) => answer(model, id, allow),
    HeadAnswered: ({ allow }) => {
      const head = model.queue[0];

      return head === undefined ? next(model) : answer(model, head.id, allow);
    },
    RequesterGone: ({ requester }) => requesterGone(model, requester),
  });
}

function stateOf(entry: Pending): PromptState {
  switch (entry.kind) {
    case "permission":
      return entry.mediaTypes === undefined
        ? { kind: "permission", origin: entry.origin, permission: entry.permission }
        : {
            kind: "permission",
            origin: entry.origin,
            permission: entry.permission,
            mediaTypes: entry.mediaTypes,
          };
    case "external-protocol":
      return {
        kind: "external-protocol",
        origin: entry.origin,
        scheme: entry.scheme,
        url: entry.urls[0]!,
      };
    case "session-restore":
      return { kind: "session-restore", tabCount: entry.tabCount };
  }
}

/** What the chrome shows: the head of the queue, or nothing. */
export function head(model: Model): PromptWire | null {
  const first = model.queue[0];

  return first === undefined ? null : { id: first.id, state: stateOf(first) };
}

export const sessionRestorePending = (model: Model): boolean =>
  model.queue.some((entry) => entry.kind === "session-restore");

/** A permission Chromium grants, asks about, or denies, before anything is remembered. */
const GRANT = new Set(["fullscreen", "pointerLock", "clipboard-sanitized-write"]);

export type Ruling =
  | { readonly kind: "grant" }
  | { readonly kind: "deny" }
  | {
      readonly kind: "ask";
      readonly permission: PromptablePermission;
      readonly mediaTypes: ReadonlyArray<MediaType> | undefined;
    };

const isPromptable = Schema.is(PromptablePermission);

/**
 * Electron's request handler has to answer or wait on the spot, so the
 * ruling is a pure read of the model, like `resolveKey`. Deny by default.
 */
export function rulePermission(
  model: Model,
  permission: string,
  origin: string | null,
  mediaTypes: ReadonlyArray<MediaType> | undefined,
): Ruling {
  if (GRANT.has(permission)) return { kind: "grant" };

  if (!isPromptable(permission) || origin === null) return { kind: "deny" };

  if (permission !== "media") {
    const known = model.permissions.get(permissionKey(origin, permission));

    if (known === undefined) return { kind: "ask", permission, mediaTypes: undefined };

    return known ? { kind: "grant" } : { kind: "deny" };
  }

  const types: ReadonlyArray<MediaType> =
    mediaTypes && mediaTypes.length > 0 ? mediaTypes : ["video", "audio"];

  const remembered = types.map((type) =>
    model.permissions.get(permissionKey(origin, "media", type)),
  );

  if (remembered.includes(false)) return { kind: "deny" };

  if (remembered.every((decision) => decision === true)) return { kind: "grant" };

  return {
    kind: "ask",
    permission,
    mediaTypes: types.filter((_type, index) => remembered[index] === undefined),
  };
}

/** The synchronous `check` handler: only a remembered grant passes. */
export function checkPermission(
  model: Model,
  permission: string,
  origin: string | null,
  mediaType: string | undefined,
): boolean {
  if (GRANT.has(permission)) return true;

  if (!isPromptable(permission) || origin === null) return false;

  if (permission !== "media")
    return model.permissions.get(permissionKey(origin, permission)) ?? false;

  if (mediaType !== "video" && mediaType !== "audio") return false;

  return model.permissions.get(permissionKey(origin, "media", mediaType)) ?? false;
}
