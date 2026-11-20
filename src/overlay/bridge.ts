import { Effect, Stream } from "effect";
import { EventListeners, openClient, receivePort } from "../shared/rpc/client";
import type { CompletionCandidate } from "../shared/schema/completion";
import { OverlayIntent, OverlayRpcs, type OverlayEvent } from "../shared/rpc/overlay";

/** The overlay's whole surface: render a list, report its height and a click. */
export function createOverlayBridge(ask: () => void) {
  const events = new EventListeners<OverlayEvent>();
  const client = receivePort(ask).then((port) => openClient(OverlayRpcs, port));

  void client.then((rpc) =>
    Effect.runFork(
      Stream.runForEach(rpc.Subscribe(), (event) => Effect.sync(() => events.emit(event))),
    ),
  );

  const dispatch = (message: OverlayIntent): void =>
    void client.then((rpc) => Effect.runFork(rpc.Dispatch(message)));

  return {
    events,
    measured: (height: number) => dispatch(OverlayIntent.cases.CompletionMeasured.make({ height })),
    clicked: (candidate: CompletionCandidate) =>
      dispatch(OverlayIntent.cases.CompletionClicked.make({ candidate })),
  };
}
