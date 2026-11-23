import { Effect, Scope, Stream } from "effect";
import { injectUserCss } from "../shared/inject-css";
import { openClient, receivePort } from "../shared/rpc/client";
import { PaletteRpcs } from "../shared/rpc/palette";
import { make, type Interpret } from "../shared/tea/store";
import { Cmd, type Model, type Msg, program } from "./palette.program";

const client = receivePort(() => window.kvist.connect()).then((port) =>
  openClient(PaletteRpcs, port),
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

/** The palette's loop, as its component sees it, plus the questions main answers. */
export const palette = {
  get model(): Model {
    return model;
  },
  dispatch: store.dispatch,
  suggestions: (query: string) =>
    client.then((rpc) => Effect.runPromise(rpc.Suggestions({ query }))),
  commandCompletions: (line: string) =>
    client.then((rpc) => Effect.runPromise(rpc.CommandCompletions({ line }))),
};
