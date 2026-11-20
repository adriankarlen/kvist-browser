import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer, Schema, Scope, Stream } from "effect";
import { Rpc, RpcClient, RpcGroup, type RpcMessage, RpcServer } from "effect/rpc";
import { clientProtocol, type Port, serverProtocol } from "./port";

class TestRpcs extends RpcGroup.make(
  Rpc.make("Echo", { payload: { text: Schema.String }, success: Schema.String }),
  Rpc.make("Count", { payload: { to: Schema.Int }, success: Schema.Int, stream: true }),
) {}

/**
 * Two connected ends that behave like a real port: delivery is
 * asynchronous, and messages wait in a buffer until the receiving end
 * starts listening.
 */
function pair<A, B>(): {
  readonly a: Port<A, B>;
  readonly b: Port<B, A>;
  readonly closed: () => boolean;
} {
  let closed = false;
  const closers = new Set<() => void>();

  const end = <In, Out>(deliverTo: (message: Out) => void) => {
    const buffer: In[] = [];
    let listener: ((message: In) => void) | undefined;

    const receive = (message: In) => {
      if (listener === undefined) buffer.push(message);
      else listener(message);
    };

    const port: Port<In, Out> = {
      post: (message) => {
        if (!closed) queueMicrotask(() => deliverTo(message));
      },
      listen: (onMessage, onClose) => {
        listener = onMessage;
        closers.add(onClose);

        for (const message of buffer.splice(0)) queueMicrotask(() => onMessage(message));

        return () => {
          listener = undefined;
          closers.delete(onClose);
        };
      },
      close: () => {
        if (closed) return;
        closed = true;

        for (const onClose of closers) queueMicrotask(onClose);
      },
    };

    return { port, receive };
  };

  let receiveA: (message: A) => void = () => {};
  let receiveB: (message: B) => void = () => {};
  const a = end<A, B>((message) => receiveB(message));
  const b = end<B, A>((message) => receiveA(message));

  receiveA = a.receive;
  receiveB = b.receive;

  return { a: a.port, b: b.port, closed: () => closed };
}

const handlers = TestRpcs.toLayer({
  Echo: ({ text }) => Effect.succeed(`echo ${text}`),
  Count: ({ to }) => Stream.range(1, to),
});

const connect = Effect.gen(function* () {
  const ends = pair<RpcMessageIn, RpcMessageOut>();

  yield* RpcServer.make(TestRpcs).pipe(
    Effect.provide(
      Layer.mergeAll(handlers, Layer.effect(RpcServer.Protocol, serverProtocol(ends.a))),
    ),
    Effect.forkScoped,
  );

  const protocol = yield* clientProtocol(ends.b);

  const client = yield* RpcClient.make(TestRpcs).pipe(
    Effect.provideService(RpcClient.Protocol, protocol),
  );

  return { client, closed: ends.closed };
});

type RpcMessageIn = RpcMessage.FromClientEncoded;

type RpcMessageOut = RpcMessage.FromServerEncoded;

describe("port protocol", () => {
  it.effect("a request gets its answer back over the port", () =>
    Effect.gen(function* () {
      const { client } = yield* connect;

      expect(yield* client.Echo({ text: "hi" })).toBe("echo hi");
    }).pipe(Effect.scoped),
  );

  it.effect("a streaming rpc delivers every element, in order", () =>
    Effect.gen(function* () {
      const { client } = yield* connect;
      const counted = yield* client.Count({ to: 5 }).pipe(Stream.runCollect);

      expect(counted).toEqual([1, 2, 3, 4, 5]);
    }).pipe(Effect.scoped),
  );

  it.effect("closing the server's scope closes the port", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const { closed } = yield* connect.pipe(Scope.provide(scope));

      expect(closed()).toBe(false);
      yield* Scope.close(scope, Exit.void);
      expect(closed()).toBe(true);
    }),
  );
});
