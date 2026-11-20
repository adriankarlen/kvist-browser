import { Effect, PubSub, Stream } from "effect";

/**
 * Events for one surface. Tags listed as state are replayed to a new
 * subscriber, so a renderer that loads or reloads late still starts from
 * what main last said.
 */
export class EventLink<E extends { readonly _tag: string }> {
  readonly #pubsub = Effect.runSync(PubSub.unbounded<E>());
  readonly #latest = new Map<string, E>();
  readonly #state: ReadonlySet<string>;

  constructor(state: ReadonlyArray<E["_tag"]>) {
    this.#state = new Set(state);
  }

  publish(event: E): void {
    if (this.#state.has(event._tag)) this.#latest.set(event._tag, event);
    PubSub.publishUnsafe(this.#pubsub, event);
  }

  readonly stream: Stream.Stream<E> = Stream.unwrap(
    Effect.map(PubSub.subscribe(this.#pubsub), (subscription) =>
      Stream.concat(
        Stream.fromIterable([...this.#latest.values()]),
        Stream.fromSubscription(subscription),
      ),
    ),
  );
}
