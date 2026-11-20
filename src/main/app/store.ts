import { Context, Effect, Layer, Stream } from "effect";
import { interpretAll, interpreter, make, type Store } from "../../shared/tea/store";
import * as Messages from "../features/messages/messages.program";
import * as MessagesFx from "../features/messages/messages.effects";
import { type Cmd, type Model, type Msg, program } from "./program";

const interpret = interpretAll<Msg, Cmd, never, never>([
  interpreter(Messages.Cmd, MessagesFx.interpret),
]);

/** Main's one loop, app-scoped: it starts with the runtime and stops with it. */
export class MainStore extends Context.Service<MainStore, Store<Model, Msg>>()("kvist/MainStore") {
  static layer = Layer.effect(MainStore, make(program, interpret));
}

/**
 * A slice of the model, pushed out every time it changes. This is how a
 * view leaves main: the selector is the view, `publish` the transport.
 */
export const project = <A>(
  select: (model: Model) => A,
  publish: (value: A) => void,
): Effect.Effect<void, never, MainStore> =>
  Effect.flatMap(Effect.service(MainStore), (store) =>
    store.changes.pipe(
      Stream.map(select),
      Stream.changes,
      Stream.runForEach((value) => Effect.sync(() => publish(value))),
    ),
  );
