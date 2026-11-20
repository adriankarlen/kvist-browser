import { ipcRenderer } from "electron";
import { Effect, Stream } from "effect";
import { EventListeners, openClient } from "../shared/rpc/client";
import { type PageEvent, PageIntent, PageRpcs } from "../shared/rpc/page";
import type { Point } from "../shared/schema/browser";

/**
 * The tab's RPC port, kept in the preload's isolated world. It is never
 * forwarded to the page: the page's own scripts must not reach main.
 */
const port = new Promise<MessagePort>((resolve) => {
  ipcRenderer.once("kvist:port", (event) => {
    const [received] = event.ports;

    if (received !== undefined) resolve(received);
  });
  ipcRenderer.send("kvist:connect");
});

const client = port.then((received) => openClient(PageRpcs, received));

/** What main tells this tab, by event. */
export const fromMain = new EventListeners<PageEvent>();

void client.then((rpc) =>
  Effect.runFork(
    Stream.runForEach(rpc.Subscribe(), (event) => Effect.sync(() => fromMain.emit(event))),
  ),
);

const dispatch = (message: PageIntent): void =>
  void client.then((rpc) => Effect.runFork(rpc.Dispatch(message)));

const intent = PageIntent.cases;

/** What this tab tells main. */
export const pageToMain = {
  pageEditable: (editable: boolean) => dispatch(intent.EditableChanged.make({ editable })),
  hintsClick: (point: Point) => dispatch(intent.HintClicked.make({ point })),
  hintsDone: () => dispatch(intent.HintsEnded.make({})),
  contextMenuPick: (id: string | null) => dispatch(intent.ContextMenuPicked.make({ id })),
};
