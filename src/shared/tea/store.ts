import { Cause, Effect, FiberMap, FiberSet, PubSub, Stream } from "effect";
import type { Scope } from "effect";
import type { Program } from "./program";

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
