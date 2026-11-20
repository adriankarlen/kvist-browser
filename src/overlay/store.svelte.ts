import { Effect, Scope, Stream } from "effect";
import { injectUserCss } from "../shared/inject-css";
import { openClient, receivePort } from "../shared/rpc/client";
import { OverlayRpcs } from "../shared/rpc/overlay";
import { make, type Interpret } from "../shared/tea/store";
import { Cmd, type Model, type Msg, program } from "./overlay.program";

const client = receivePort(() => window.kvist.connect()).then((port) =>
  openClient(OverlayRpcs, port),
);

const interpret: Interpret<Msg, Cmd, never, never> = (cmd) =>
  Cmd.match(cmd, {
    InjectCss: ({ css }) => Effect.sync(() => injectUserCss(css)),
    SendToMain: ({ intent }) =>
      Effect.promise(() => client).pipe(
        Effect.flatMap((rpc) => rpc.Dispatch(intent)),
        Effect.ignore,
      ),
  });

// Raw: the list is replaced wholesale on every push and never mutated.
let model = $state.raw<Model>(program.init.model);

const store = Effect.runSync(
  make(program, interpret).pipe(Scope.provide(Effect.runSync(Scope.make()))),
);

Effect.runFork(
  Stream.runForEach(store.changes, (next) =>
    Effect.sync(() => {
      model = next;
    }),
  ),
);

void client.then((rpc) =>
  Effect.runFork(
    Stream.runForEach(rpc.Subscribe(), (event) => Effect.sync(() => store.dispatch(event))),
  ),
);

/** The overlay's loop, as its one component sees it. */
export const overlay = {
  get model(): Model {
    return model;
  },
  dispatch: store.dispatch,
};
