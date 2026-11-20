import { Context, Effect, Layer, PubSub, Stream } from "effect";

/** What a requester's lifetime is tied to: the tab that asked. */
export type Watchable = Pick<Electron.WebContents, "once" | "removeListener">;

interface Waiting {
  readonly answer: ((allow: boolean) => void) | undefined;
  readonly release: () => void;
}

/**
 * The Electron continuations behind pending questions. The model keeps only
 * request ids; the callbacks and the `destroyed` watches live here. Both
 * exits release the watch: settling, and the tab dying first.
 */
export class Requesters extends Context.Service<
  Requesters,
  {
    /** A new id for someone waiting, watched for as long as `contents` lives. */
    readonly register: (contents: Watchable | null, answer?: (allow: boolean) => void) => number;
    readonly settle: (ids: ReadonlyArray<number>, allow: boolean) => void;
    /** Ids whose tab died before an answer came. */
    readonly gone: Stream.Stream<number>;
  }
>()("kvist/Requesters") {
  static layer = Layer.effect(
    Requesters,
    Effect.gen(function* () {
      const gone = yield* Effect.acquireRelease(PubSub.unbounded<number>(), PubSub.shutdown);
      const waiting = new Map<number, Waiting>();
      let nextId = 1;

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const entry of waiting.values()) entry.release();
          waiting.clear();
        }),
      );

      return {
        register: (contents, answer) => {
          const id = nextId++;

          const onDestroyed = (): void => {
            waiting.delete(id);
            PubSub.publishUnsafe(gone, id);
          };

          contents?.once("destroyed", onDestroyed);
          waiting.set(id, {
            answer,
            release: () => contents?.removeListener("destroyed", onDestroyed),
          });

          return id;
        },
        settle: (ids, allow) => {
          for (const id of ids) {
            const entry = waiting.get(id);

            if (entry === undefined) continue;
            waiting.delete(id);
            entry.release();
            entry.answer?.(allow);
          }
        },
        gone: Stream.fromPubSub(gone),
      };
    }),
  );
}
