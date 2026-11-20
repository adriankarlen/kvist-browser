import { expect, it } from "@effect/vitest";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { AppLayer, disposeNow } from "./runtime";

class Resource extends Context.Service<Resource, { readonly closed: () => boolean }>()(
  "test/Resource",
) {}

it("the app scope closes synchronously, running sync finalizers on the same tick", () => {
  let closed = false;

  const layer = Layer.effect(
    Resource,
    Effect.acquireRelease(Effect.succeed({ closed: () => closed }), () =>
      Effect.sync(() => {
        closed = true;
      }),
    ),
  );

  const runtime = ManagedRuntime.make(Layer.merge(AppLayer, layer));

  expect(runtime.runSync(Effect.map(Resource, (r) => r.closed()))).toBe(false);
  disposeNow(runtime);
  expect(closed).toBe(true);
});
