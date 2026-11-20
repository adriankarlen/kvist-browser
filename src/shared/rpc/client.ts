import { Effect, Scope } from "effect";
import { RpcClient, type Rpc, type RpcGroup } from "effect/rpc";
import { clientProtocol, domPort } from "./port";

/** The message a preload uses to hand its document the port main sent. */
export const PORT_MESSAGE = "kvist:port";

/**
 * Waits for the port the preload forwards, after asking for one. Asking
 * first would race a listener that is not attached yet.
 */
export function receivePort(ask: () => void): Promise<MessagePort> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent): void => {
      const [port] = event.ports;

      if (event.source !== window || event.data !== PORT_MESSAGE || port === undefined) return;
      window.removeEventListener("message", onMessage);
      resolve(port);
    };

    window.addEventListener("message", onMessage);
    ask();
  });
}

/** An RPC client over a renderer's port, living as long as the document does. */
export function openClient<Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  port: MessagePort,
): Promise<RpcClient.RpcClient<Rpcs, unknown>> {
  const scope = Effect.runSync(Scope.make());

  return Effect.runPromise(
    Effect.gen(function* () {
      const protocol = yield* clientProtocol(domPort(port));

      return yield* RpcClient.make(group).pipe(Effect.provideService(RpcClient.Protocol, protocol));
    }).pipe(Scope.provide(scope)),
  );
}

/**
 * Listeners keyed by event tag, so a store can subscribe to the one event it
 * renders. Each subscription answers with its unsubscribe.
 */
export class EventListeners<E extends { readonly _tag: string }> {
  readonly #listeners = new Map<string, Set<(event: E) => void>>();

  on<T extends E["_tag"]>(tag: T, listener: (event: Extract<E, { _tag: T }>) => void): () => void {
    const set = this.#listeners.get(tag) ?? new Set();
    // SAFETY: `emit` only calls a listener with events whose tag it registered for.
    const widened = listener as (event: E) => void;

    set.add(widened);
    this.#listeners.set(tag, set);

    return () => void set.delete(widened);
  }

  emit(event: E): void {
    for (const listener of this.#listeners.get(event._tag) ?? []) listener(event);
  }
}
