import { Cause, Effect, FiberMap, FiberSet, PubSub, Stream } from "effect";
import type { Scope } from "effect";
import { type Program, type Tagged, type TaggedCases, tagsOf } from "./program";

/** The impure half: turns one Cmd into work, reporting back through `dispatch`. */
export type Interpret<Msg, Cmd, E, R> = (
  cmd: Cmd,
  dispatch: (msg: Msg) => void,
) => Effect.Effect<void, E, R>;

export interface Store<Model, Msg> {
  /** The model as it stands. Synchronous, for callers that must answer on the same tick. */
  readonly get: () => Model;
  /** Synchronous and re-entrant: a Msg raised mid-update is queued and handled in order. */
  readonly dispatch: (msg: Msg) => void;
  /** Every new model, starting with the current one. */
  readonly changes: Stream.Stream<Model>;
}

/**
 * Runs a program. Cmds start on the same tick as the Msg that produced
 * them, on fibers owned by the store's scope; closing the scope interrupts
 * them and turns `dispatch` into a no-op.
 */
export const make = <Model, Msg, Cmd, E, R>(
  program: Program<Model, Msg, Cmd>,
  interpret: Interpret<Msg, Cmd, E, R>,
): Effect.Effect<Store<Model, Msg>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const runKeyed = yield* FiberMap.makeRuntime<R, string>();
    const runFree = yield* FiberSet.makeRuntime<R>();

    const models = yield* Effect.acquireRelease(PubSub.unbounded<Model>({ replay: 1 }), (pubsub) =>
      PubSub.shutdown(pubsub),
    );

    let model = program.init.model;
    let open = true;
    let draining = false;
    const pending: Msg[] = [];

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        open = false;
      }),
    );

    const start = (cmd: Cmd): void => {
      const work = interpret(cmd, dispatch).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logError("command failed", cause),
        ),
      );

      const key = program.keyOf?.(cmd);

      if (key === undefined) runFree(work);
      else runKeyed(key, work);
    };

    const drain = (): ReadonlyArray<Cmd> => {
      const cmds: Cmd[] = [];

      for (let msg = pending.shift(); msg !== undefined; msg = pending.shift()) {
        const result = program.update(msg, model);

        model = result.model;
        pending.push(...result.msgs);
        cmds.push(...result.cmds);
      }

      return cmds;
    };

    function dispatch(msg: Msg): void {
      if (!open) return;
      pending.push(msg);

      if (draining) return;

      const before = model;
      let cmds: ReadonlyArray<Cmd>;

      draining = true;

      try {
        cmds = drain();
      } catch (error) {
        // A throwing update is a bug; dropping the queue keeps one bad Msg
        // from poisoning every Msg after it.
        pending.length = 0;
        throw error;
      } finally {
        draining = false;
      }

      if (model !== before) PubSub.publishUnsafe(models, model);

      for (const cmd of cmds) start(cmd);
    }

    PubSub.publishUnsafe(models, model);

    for (const cmd of program.init.cmds) start(cmd);

    for (const msg of program.init.msgs) dispatch(msg);

    return {
      get: () => model,
      dispatch,
      changes: Stream.fromPubSub(models),
    };
  });

/** One feature's interpreter, bound to the Cmd tags it owns. */
export interface CmdRoute<Msg, Cmd, E, R> {
  readonly tags: ReadonlySet<string>;
  readonly interpret: Interpret<Msg, Cmd, E, R>;
}

/**
 * Binds a feature's interpreter to its Cmds. The root routes each Cmd by tag,
 * so a feature interpreter only ever sees its own.
 */
export function interpreter<Owned extends Cmd, Cmd extends Tagged, Msg, E, R>(
  owned: TaggedCases<Owned>,
  interpret: Interpret<NoInfer<Msg>, Owned, E, R>,
): CmdRoute<Msg, Cmd, E, R> {
  const tags = tagsOf(owned);
  const owns = (cmd: Cmd): cmd is Owned => tags.has(cmd._tag);

  return {
    tags,
    interpret: (cmd, dispatch) => (owns(cmd) ? interpret(cmd, dispatch) : Effect.void),
  };
}

/** `interpreter` with the root's types fixed once. */
export function interpretersFor<Msg, Cmd extends Tagged, E, R>() {
  return <Owned extends Cmd, E2 extends E, R2 extends R>(
    owned: TaggedCases<Owned>,
    interpret: Interpret<Msg, Owned, E2, R2>,
  ): CmdRoute<Msg, Cmd, E, R> => interpreter<Owned, Cmd, Msg, E, R>(owned, interpret);
}

/** The root interpreter: each Cmd goes to the one feature that owns its tag. */
export function interpretAll<Msg, Cmd extends Tagged, E, R>(
  routes: ReadonlyArray<CmdRoute<Msg, Cmd, E, R>>,
): Interpret<Msg, Cmd, E, R> {
  const owners = new Map<string, CmdRoute<Msg, Cmd, E, R>>();

  for (const owner of routes) {
    for (const tag of owner.tags) {
      if (owners.has(tag)) throw new Error(`kvist: two features own the Cmd ${tag}`);
      owners.set(tag, owner);
    }
  }

  return (cmd, dispatch) => owners.get(cmd._tag)?.interpret(cmd, dispatch) ?? Effect.void;
}
