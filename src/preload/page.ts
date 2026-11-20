import { ipcRenderer } from "electron";
import { Effect, Scope, Stream } from "effect";
import { openClient } from "../shared/rpc/client";
import { PageIntent, PageRpcs } from "../shared/rpc/page";
import { make, nextTurn, type Interpret } from "../shared/tea/store";
import * as hints from "./hints";
import * as menu from "./menu";
import { Cmd, Msg, program } from "./page.program";

/**
 * Runs in every tab, exposing nothing over contextBridge — a page must
 * never reach the kvist API. It reports focus landing on something typable,
 * so normal mode steps aside, and owns the DOM half of vim: scrolling and
 * link hints.
 */

const UNTYPABLE = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

// tagName rather than instanceof: the preload runs in its own world, so the
// DOM constructors it sees need not be the ones that built these nodes.
function isEditable(node: Element | null): boolean {
  if (!node) return false;

  // SAFETY: the preload runs in its own world, so instanceof cannot be trusted;
  // the probed properties are optional and read with `=== true`.
  const element = node as HTMLElement & { disabled?: boolean; readOnly?: boolean; type?: string };

  if (element.disabled === true || element.readOnly === true) return false;

  switch (element.tagName) {
    case "TEXTAREA":
      return true;
    case "INPUT":
      return !UNTYPABLE.has((element.type ?? "text").toLowerCase());
    default:
      return element.isContentEditable === true;
  }
}

// null rather than false, so the first report always reaches main: a fresh
// preload after navigation has to clear whatever the previous page left set.
/**
 * The tab's RPC port, kept in the preload's isolated world. It is never
 * forwarded to the page: the page's own scripts must not reach main.
 */
const client = new Promise<MessagePort>((resolve) => {
  ipcRenderer.once("kvist:port", (event) => {
    const [received] = event.ports;

    if (received !== undefined) resolve(received);
  });
  ipcRenderer.send("kvist:connect");
}).then((port) => openClient(PageRpcs, port));

const LINE = 60;

const scrollBy_ = (x: number, y: number) => Effect.sync(() => scrollBy(x, y));

const interpret: Interpret<Msg, Cmd, never, never> = (cmd, dispatch) =>
  Cmd.match(cmd, {
    BlurFocused: () =>
      Effect.sync(() => {
        // SAFETY: activeElement is an Element; blur() exists on any focusable (HTMLElement).
        (document.activeElement as HTMLElement | null)?.blur();
        reportFocus();
      }),
    Scroll: ({ command }) => {
      switch (command) {
        case "down":
          return scrollBy_(0, LINE);
        case "up":
          return scrollBy_(0, -LINE);
        case "half-down":
          return scrollBy_(0, innerHeight / 2);
        case "half-up":
          return scrollBy_(0, -innerHeight / 2);
        case "top":
          return Effect.sync(() => scrollTo(0, 0));
        case "bottom":
          return Effect.sync(() => scrollTo(0, document.body.scrollHeight));
      }
    },
    RenderHints: () =>
      Effect.sync(() => dispatch(Msg.cases.HintsRendered.make({ labels: hints.render() }))),
    DimHints: ({ typed }) => Effect.sync(() => hints.dim(typed)),
    ActivateHint: ({ label }) =>
      Effect.flatMap(
        Effect.sync(() => hints.activateLabel(label)),
        (point) =>
          point === undefined
            ? Effect.void
            : sendToMain(PageIntent.cases.HintClicked.make({ point })),
      ),
    HideHints: () => Effect.sync(() => void hints.hide()),
    ShowMenu: ({ menu: state }) => Effect.sync(() => menu.show(state)),
    HideMenu: () => Effect.sync(() => menu.hide()),
    SendToMain: ({ intent }) => sendToMain(intent),
    ReadFocusSoon: () => nextTurn.pipe(Effect.andThen(Effect.sync(reportFocus))),
  });

function sendToMain(intent: PageIntent): Effect.Effect<void> {
  return Effect.promise(() => client).pipe(
    Effect.flatMap((rpc) => rpc.Dispatch(intent)),
    Effect.ignore,
  );
}

const store = Effect.runSync(
  make(program, interpret).pipe(Scope.provide(Effect.runSync(Scope.make()))),
);

void client.then((rpc) =>
  Effect.runFork(
    Stream.runForEach(rpc.Subscribe(), (event) => Effect.sync(() => store.dispatch(event))),
  ),
);

menu.onClose((id) => store.dispatch(Msg.cases.MenuClosed.make({ id })));

function reportFocus(): void {
  store.dispatch(Msg.cases.FocusChanged.make({ editable: isEditable(document.activeElement) }));
}

// focusout fires before the next element takes focus, so let focus settle
// before reading it or every tab between two fields looks like a blur.
document.addEventListener("focusin", reportFocus, true);

document.addEventListener("focusout", () => store.dispatch(Msg.cases.FocusLeft.make({})), true);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", reportFocus, { once: true });
} else {
  reportFocus();
}

// Hints are positioned against the document, so anything that moves the page
// under them leaves them pointing at the wrong things.
document.addEventListener("scroll", () => store.dispatch(Msg.cases.PageScrolled.make({})), true);
