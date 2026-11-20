import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Schema, Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import { combine, next, route, type Program } from "./program";
import * as Store from "./store";

const Msg = Schema.TaggedUnion({
  Added: { by: Schema.Number },
  Echoed: { text: Schema.String },
  Doubled: {},
});

type Msg = typeof Msg.Type;

const Cmd = Schema.TaggedUnion({
  Echo: { text: Schema.String },
  Fail: {},
  Slow: { key: Schema.String, text: Schema.String },
});

type Cmd = typeof Cmd.Type;

interface Model {
  readonly count: number;
  readonly echoes: ReadonlyArray<string>;
}

const counter = (
  cmdsFor: (msg: Msg) => ReadonlyArray<Cmd> = () => [],
): Program<Model, Msg, Cmd> => ({
  init: next({ count: 0, echoes: [] }),
  update: (msg, model) =>
    Msg.match(msg, {
      Added: ({ by }) =>
        next(by === 0 ? model : { ...model, count: model.count + by }, cmdsFor(msg)),
      Echoed: ({ text }) => next({ ...model, echoes: [...model.echoes, text] }),
      Doubled: () => next(model, [], [Msg.cases.Added.make({ by: model.count })]),
    }),
  keyOf: (cmd) => (Cmd.guards.Slow(cmd) ? cmd.key : undefined),
});

const interpret: Store.Interpret<Msg, Cmd, string, never> = (cmd, dispatch) =>
  Cmd.match(cmd, {
    Echo: ({ text }) => Effect.sync(() => dispatch(Msg.cases.Echoed.make({ text }))),
    Fail: () => Effect.fail("boom"),
    Slow: ({ text }) =>
      Effect.sleep("1 second").pipe(
        Effect.andThen(Effect.sync(() => dispatch(Msg.cases.Echoed.make({ text })))),
      ),
  });

describe("Store", () => {
  it.effect("dispatch updates the model synchronously", () =>
    Effect.gen(function* () {
      const store = yield* Store.make(counter(), interpret);

      store.dispatch(Msg.cases.Added.make({ by: 2 }));
      expect(store.get().count).toBe(2);
    }),
  );

  it.effect("follow-up msgs are handled in order within the same dispatch", () =>
    Effect.gen(function* () {
      const store = yield* Store.make(counter(), interpret);

      store.dispatch(Msg.cases.Added.make({ by: 3 }));
      store.dispatch(Msg.cases.Doubled.make({}));
      expect(store.get().count).toBe(6);
    }),
  );

  it.effect("a synchronous cmd has run before dispatch returns, and its msg is queued", () =>
    Effect.gen(function* () {
      const store = yield* Store.make(
        counter(() => [Cmd.cases.Echo.make({ text: "a" }), Cmd.cases.Echo.make({ text: "b" })]),
        interpret,
      );

      store.dispatch(Msg.cases.Added.make({ by: 1 }));
      expect(store.get().echoes).toEqual(["a", "b"]);
    }),
  );

  it.effect("a failing cmd is logged and the loop carries on", () =>
    Effect.gen(function* () {
      const store = yield* Store.make(
        counter(() => [Cmd.cases.Fail.make({})]),
        interpret,
      );

      store.dispatch(Msg.cases.Added.make({ by: 1 }));
      store.dispatch(Msg.cases.Added.make({ by: 1 }));
      expect(store.get().count).toBe(2);
    }),
  );

  it.effect("a keyed cmd interrupts the running one with the same key", () =>
    Effect.gen(function* () {
      let n = 0;

      const store = yield* Store.make(
        counter(() => [Cmd.cases.Slow.make({ key: "k", text: `slow${++n}` })]),
        interpret,
      );

      store.dispatch(Msg.cases.Added.make({ by: 1 }));
      yield* TestClock.adjust("500 millis");
      store.dispatch(Msg.cases.Added.make({ by: 1 }));
      yield* TestClock.adjust("2 seconds");
      expect(store.get().echoes).toEqual(["slow2"]);
    }),
  );

  it.effect("changes starts with the current model and skips unchanged ones", () =>
    Effect.gen(function* () {
      const store = yield* Store.make(counter(), interpret);

      store.dispatch(Msg.cases.Added.make({ by: 1 }));

      const seen = yield* store.changes.pipe(
        Stream.map((model) => model.count),
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* Effect.yieldNow;
      store.dispatch(Msg.cases.Added.make({ by: 0 }));
      store.dispatch(Msg.cases.Doubled.make({}));
      store.dispatch(Msg.cases.Added.make({ by: 1 }));
      expect(yield* Fiber.join(seen)).toEqual([1, 2, 3]);
    }),
  );

  it.effect("closing the scope interrupts cmds and stops dispatch", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();

      const store = yield* Store.make(
        counter(() => [Cmd.cases.Slow.make({ key: "k", text: "late" })]),
        interpret,
      ).pipe(Scope.provide(scope));

      store.dispatch(Msg.cases.Added.make({ by: 1 }));
      yield* Scope.close(scope, Exit.void);
      yield* TestClock.adjust("2 seconds");
      store.dispatch(Msg.cases.Added.make({ by: 1 }));
      expect(store.get()).toEqual({ count: 1, echoes: [] });
    }),
  );
});

describe("combine", () => {
  const A = Schema.TaggedUnion({ Inc: {} });
  const B = Schema.TaggedUnion({ Named: { name: Schema.String } });

  type Root = { readonly a: number; readonly b: string };

  type RootMsg = typeof A.Type | typeof B.Type;

  const update = combine<Root, RootMsg, never>([
    route("a", A, (_msg, slice: number) => next(slice + 1)),
    route("b", B, (msg, _slice: string, root: Root) => next(`${msg.name}${root.a}`)),
  ]);

  it("routes each msg to its owner's slice", () => {
    const one = update(A.cases.Inc.make({}), { a: 0, b: "" });
    const two = update(B.cases.Named.make({ name: "x" }), one.model);

    expect(two.model).toEqual({ a: 1, b: "x1" });
  });

  it("keeps the root's identity when a slice is unchanged", () => {
    const root: Root = { a: 0, b: "" };

    const same = combine<Root, RootMsg, never>([
      route("a", A, (_msg, slice: number) => next(slice)),
    ]);

    expect(same(A.cases.Inc.make({}), root).model).toBe(root);
  });

  it("refuses two features that own one tag", () => {
    expect(() =>
      combine<Root, RootMsg, never>([
        route("a", A, (_msg, slice: number) => next(slice)),
        route("a", A, (_msg, slice: number) => next(slice)),
      ]),
    ).toThrow("two features own the Msg Inc");
  });
});
