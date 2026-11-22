import { Effect, Scope, Stream } from "effect";
import { ChromeRpcs } from "../../shared/rpc/chrome";
import { openClient, receivePort } from "../../shared/rpc/client";
import { injectUserCss } from "../../shared/inject-css";
import type { CompletionCandidate } from "../../shared/schema/completion";
import { interpretAll, interpretersFor, make, type Store } from "../../shared/tea/store";
import * as Bookmarks from "../features/bookmarks/bookmarks.program";
import * as Downloads from "../features/downloads/downloads.program";
import * as Link from "../features/link/link.program";
import { type Cmd, type Model, type Msg, program } from "./program";

const client = receivePort(() => window.kvist.connect()).then((port) =>
  openClient(ChromeRpcs, port),
);

/** Elements a Cmd may focus, registered by the component that renders each. */
const elements = new Map<string, HTMLElement>();

/** Whoever showed the completion list last; a picked row goes to it. */
let acceptCompletion: ((candidate: CompletionCandidate) => void) | null = null;

const interpreter = interpretersFor<Msg, Cmd, never, never>();

const interpret = interpretAll<Msg, Cmd, never, never>([
  interpreter(Link.Cmd, (cmd) =>
    Link.Cmd.match(cmd, {
      SendToMain: ({ intent }) =>
        Effect.promise(() => client).pipe(
          Effect.flatMap((rpc) => rpc.Dispatch(intent)),
          Effect.ignore,
        ),
      InjectCss: ({ css }) => Effect.sync(() => injectUserCss(css)),
      FocusElement: ({ name }) => Effect.sync(() => elements.get(name)?.focus()),
      AcceptCompletion: ({ candidate }) => Effect.sync(() => acceptCompletion?.(candidate)),
    }),
  ),
  interpreter(Bookmarks.Cmd, (cmd, dispatch) =>
    Bookmarks.Cmd.match(cmd, {
      FetchBookmarks: ({ query }) =>
        Effect.sleep(Bookmarks.DEBOUNCE).pipe(
          Effect.andThen(Effect.promise(() => client)),
          Effect.flatMap((rpc) => rpc.BookmarkRows({ query })),
          Effect.flatMap((rows) =>
            Effect.sync(() =>
              dispatch(Bookmarks.Msg.cases.BookmarksFetched.make({ query, rows: [...rows] })),
            ),
          ),
          Effect.ignore,
        ),
    }),
  ),
  interpreter(Downloads.Cmd, (cmd, dispatch) =>
    Downloads.Cmd.match(cmd, {
      LingerDownloads: () =>
        Effect.sleep(Downloads.LINGER).pipe(
          Effect.andThen(
            Effect.sync(() => dispatch(Downloads.Msg.cases.DownloadsLingerEnded.make({}))),
          ),
        ),
    }),
  ),
]);

// Raw: the model is replaced wholesale with structural sharing, never mutated,
// so a slice that did not change does not propagate.
let model = $state.raw<Model>(program.init.model);

/** Lives as long as the document; nothing in the chrome outlives it. */
const store: Store<Model, Msg> = Effect.runSync(
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
    Stream.runForEach(rpc.Subscribe(), (event) => Effect.sync(() => app.dispatch(event))),
  ),
);

/** The chrome's loop, as components see it: read `model`, `dispatch` Msgs. */
export const app = {
  get model(): Model {
    return model;
  },
  dispatch: (msg: Msg): void => store.dispatch(msg),
};

/** Questions main answers, for completion sources; components never hold the client. */
export const queries = {
  omniboxSuggestions: (query: string) =>
    client.then((rpc) => Effect.runPromise(rpc.OmniboxSuggestions({ query }))),
  commandCompletions: (line: string) =>
    client.then((rpc) => Effect.runPromise(rpc.CommandCompletions({ line }))),
};

/** Lets a Cmd focus `name`; the returned function forgets it. */
export function registerElement(name: string, element: HTMLElement): () => void {
  elements.set(name, element);

  return () => {
    if (elements.get(name) === element) elements.delete(name);
  };
}

/** The input now showing the completion list receives the row picked in it. */
export function claimCompletion(accept: (candidate: CompletionCandidate) => void): void {
  acceptCompletion = accept;
}
