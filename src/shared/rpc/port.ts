import { Cause, Effect, Queue, Schema } from "effect";
import { RpcClient, type RpcMessage, RpcServer } from "effect/rpc";

type FromClientEncoded = RpcMessage.FromClientEncoded;

type FromServerEncoded = RpcMessage.FromServerEncoded;

/**
 * Both ends of a `MessagePort`, whichever kind it is: Electron's
 * `MessagePortMain` in main, the DOM's `MessagePort` in a renderer.
 * Structured clone carries the messages, so nothing is serialized by hand.
 */
export interface Port<In, Out> {
  readonly post: (message: Out) => void;
  /** Starts delivery; the returned function stops listening. */
  readonly listen: (onMessage: (message: In) => void, onClose: () => void) => () => void;
  readonly close: () => void;
}

/** One port serves one client, so its id is fixed. */
const CLIENT = 0;

/**
 * A server protocol over a single port. The port is the capability: whoever
 * holds the other end can call exactly the group this server runs, so there
 * is no sender to check.
 */
export const serverProtocol = (port: Port<FromClientEncoded, FromServerEncoded>) =>
  RpcServer.Protocol.make((writeRequest) =>
    Effect.gen(function* () {
      const inbox = yield* Queue.unbounded<FromClientEncoded>();
      const disconnects = yield* Queue.unbounded<number>();

      yield* Effect.acquireRelease(
        Effect.sync(() =>
          port.listen(
            (message) => Queue.offerUnsafe(inbox, message),
            () => Queue.offerUnsafe(disconnects, CLIENT),
          ),
        ),
        (release) =>
          Effect.sync(() => {
            release();
            port.close();
          }),
      );

      yield* Queue.take(inbox).pipe(
        Effect.flatMap((message) => writeRequest(CLIENT, message)),
        Effect.forever,
        Effect.forkScoped,
      );

      return {
        disconnects,
        send: (_clientId, response) => Effect.sync(() => port.post(response)),
        end: () => Effect.void,
        clientIds: Effect.succeed(new Set([CLIENT])),
        initialMessage: Effect.succeedNone,
        supportsAck: true,
        supportsTransferables: false,
        supportsSpanPropagation: false,
        supportsNotifications: false,
        codecFor: Schema.toCodecJson,
      };
    }),
  );

/** A client protocol over a single port; the matching end of `serverProtocol`. */
export const clientProtocol = (port: Port<FromServerEncoded, FromClientEncoded>) =>
  RpcClient.Protocol.make((writeResponse, clientIds) =>
    Effect.gen(function* () {
      const inbox = yield* Queue.unbounded<FromServerEncoded, Cause.Done>();

      yield* Effect.acquireRelease(
        Effect.sync(() =>
          port.listen(
            (message) => Queue.offerUnsafe(inbox, message),
            () => Queue.endUnsafe(inbox),
          ),
        ),
        (release) =>
          Effect.sync(() => {
            release();
            port.close();
          }),
      );

      yield* Queue.take(inbox).pipe(
        Effect.flatMap((message) =>
          Effect.forEach(clientIds, (clientId) => writeResponse(clientId, message), {
            discard: true,
          }),
        ),
        Effect.forever,
        Effect.catchIf(Cause.isDone, () => Effect.void),
        Effect.forkScoped,
      );

      return {
        send: (_clientId, request) => Effect.sync(() => port.post(request)),
        supportsAck: true,
        supportsTransferables: false,
        codecFor: Schema.toCodecJson,
      };
    }),
  );

/**
 * A renderer's end. `start` is what releases the messages the port buffered
 * before anyone listened, so nothing sent during startup is lost.
 */
export function domPort<In, Out>(port: MessagePort): Port<In, Out> {
  return {
    post: (message) => port.postMessage(message),
    listen: (onMessage, onClose) => {
      const message = (event: MessageEvent<In>) => onMessage(event.data);

      port.addEventListener("message", message);
      port.addEventListener("close", onClose);
      port.start();

      return () => {
        port.removeEventListener("message", message);
        port.removeEventListener("close", onClose);
      };
    },
    close: () => port.close(),
  };
}
