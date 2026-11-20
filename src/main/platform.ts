import { NodeFileSystem } from "@effect/platform-node";
import { Effect, FileSystem, Option } from "effect";

/**
 * Effect's file system and logger for the callback-shaped modules that
 * Electron and the ad blocker call into with promises. Everything still
 * goes through Effect, so one logger sees it and tests can replace it.
 */
const withFs = <A>(use: (fs: FileSystem.FileSystem) => Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(
    Effect.flatMap(Effect.service(FileSystem.FileSystem), use).pipe(
      Effect.provide(NodeFileSystem.layer),
    ),
  );

export const readText = (path: string): Promise<string> => withFs((fs) => fs.readFileString(path));

export const readBytes = (path: string): Promise<Buffer> =>
  withFs((fs) => Effect.map(fs.readFile(path), (bytes) => Buffer.from(bytes)));

export const writeBytes = (path: string, bytes: Uint8Array): Promise<void> =>
  withFs((fs) => fs.writeFile(path, bytes));

/** Milliseconds since the file last changed. */
export const modifiedAt = (path: string): Promise<number> =>
  withFs((fs) =>
    Effect.map(fs.stat(path), (info) =>
      Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() }),
    ),
  );

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejection reason is unknown; it is only logged
export function logError(what: string, error: unknown): void {
  Effect.runFork(Effect.logError(what, error));
}
