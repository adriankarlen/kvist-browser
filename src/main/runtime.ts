import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, Logger, ManagedRuntime } from "effect";

const logging = Logger.layer([Logger.withLeveledConsole(Logger.formatSimple)]);

/** Everything app-scoped that every process-wide service builds on. */
export const AppLayer = Layer.mergeAll(NodeServices.layer, logging);

export type AppServices = Layer.Success<typeof AppLayer>;

/**
 * Closes the app scope on the same tick. `quit` cannot wait: a finalizer
 * that goes async would be cut off when the process exits, so every
 * quit-time finalizer must be synchronous, and this throws if one is not.
 */
export function disposeNow<R, E>(runtime: ManagedRuntime.ManagedRuntime<R, E>): void {
  Effect.runSync(runtime.disposeEffect);
}
