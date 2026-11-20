import type { Schema } from "effect";

/**
 * The pure half of the loop: a program decides, it never does. See
 * `docs/architecture.md`.
 */

/** What one Msg produced: the new model, work to start, and follow-up Msgs. */
export interface Next<Model, Msg, Cmd> {
  readonly model: Model;
  readonly cmds: ReadonlyArray<Cmd>;
  readonly msgs: ReadonlyArray<Msg>;
}

const none: ReadonlyArray<never> = [];

export function next<Model, Msg = never, Cmd = never>(
  model: Model,
  cmds: ReadonlyArray<Cmd> = none,
  msgs: ReadonlyArray<Msg> = none,
): Next<Model, Msg, Cmd> {
  return { model, cmds, msgs };
}

export interface Program<Model, Msg, Cmd> {
  readonly init: Next<Model, Msg, Cmd>;
  /** Pure and synchronous. The only writer of the model. */
  readonly update: (msg: Msg, model: Model) => Next<Model, Msg, Cmd>;
  /** A keyed Cmd interrupts the running Cmd with the same key. */
  readonly keyOf?: (cmd: Cmd) => string | undefined;
}

/** Anything a feature's Msgs are tagged with. */
export interface Tagged {
  readonly _tag: string;
}

/** A tagged union schema, read only for its case names. */
export interface TaggedCases<T extends Tagged> {
  readonly Type: T;
  readonly cases: Readonly<Record<T["_tag"], Schema.Top>>;
}

/** The case names of a tagged union, which is how a root finds a Msg's owner. */
export function tagsOf<T extends Tagged>(schema: TaggedCases<T>): ReadonlySet<string> {
  return new Set(Object.keys(schema.cases));
}

/** One feature's slot in a root program: which Msgs it owns and how it updates its slice. */
export interface Route<Root, Msg, Cmd> {
  readonly tags: ReadonlySet<string>;
  readonly update: (msg: Msg, root: Root) => Next<Root, Msg, Cmd>;
}

/**
 * Binds a feature to its slice of the root. The feature reads `root` but
 * writes only its own slice; a slice left unchanged keeps the root's
 * identity, so nothing downstream sees a change.
 */
export function route<Root, K extends keyof Root, Owned extends Msg, Msg extends Tagged, Cmd>(
  key: K,
  owned: TaggedCases<Owned>,
  update: (msg: Owned, slice: Root[K], root: Root) => Next<Root[K], Msg, Cmd>,
): Route<Root, Msg, Cmd> {
  const tags = tagsOf(owned);
  const owns = (msg: Msg): msg is Owned => tags.has(msg._tag);

  return {
    tags,
    update: (msg, root) => {
      if (!owns(msg)) return next(root);
      const result = update(msg, root[key], root);
      const model = result.model === root[key] ? root : { ...root, [key]: result.model };

      return { model, cmds: result.cmds, msgs: result.msgs };
    },
  };
}

/**
 * The root update: each Msg goes to the one feature that owns its tag. Two
 * features claiming one tag is a wiring bug, so it throws at startup instead
 * of picking whichever feature was listed first.
 */
export function combine<Root, Msg extends Tagged, Cmd>(
  routes: ReadonlyArray<Route<Root, Msg, Cmd>>,
): (msg: Msg, root: Root) => Next<Root, Msg, Cmd> {
  const owners = new Map<string, Route<Root, Msg, Cmd>>();

  for (const owner of routes) {
    for (const tag of owner.tags) {
      if (owners.has(tag)) throw new Error(`kvist: two features own the Msg ${tag}`);
      owners.set(tag, owner);
    }
  }

  return (msg, root) => owners.get(msg._tag)?.update(msg, root) ?? next(root);
}
