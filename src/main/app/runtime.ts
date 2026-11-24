import { databaseLayer, prepareDatabaseFile } from "../db/database";
import { BookmarksRepo } from "../services/bookmarks-repo";
import { HistoryRepo } from "../services/history-repo";
import { SessionRepo } from "../services/session-repo";
import { ConfigFiles } from "../services/config-files";
import { DownloadsGate } from "../services/downloads-gate";
import { LiveDownloads } from "../services/live-downloads";
import { MainStore } from "./store";
import { dataDir } from "../paths";
import { PromptsGate } from "../services/prompts-gate";
import { Requesters } from "../services/requesters";
import { Desktop } from "../services/desktop";
import { LegacyWindow } from "../services/legacy-window";
import { ConfigApplier } from "../services/config-applier";
import { StyleFiles } from "../services/style-files";
import { ZoomRepo } from "../services/zoom-repo";
import { AppLayer } from "../runtime";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { Context } from "effect";

/** The app scope: closed on `quit`, never on `will-quit`, which can be cancelled. */
export const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    StyleFiles.layer,
    Layer.mergeAll(PromptsGate.layer, DownloadsGate.layer).pipe(
      Layer.provideMerge(MainStore.layer),
    ),
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ConfigFiles.layer,
        Requesters.layer,
        Desktop.layer,
        LegacyWindow.layer,
        LiveDownloads.layer,
        ConfigApplier.layer,
        Layer.mergeAll(
          HistoryRepo.layer,
          BookmarksRepo.layer,
          SessionRepo.layer,
          ZoomRepo.layer,
        ).pipe(
          Layer.provide(Layer.unwrap(Effect.map(prepareDatabaseFile(dataDir), databaseLayer))),
        ),
      ),
    ),
    Layer.provideMerge(AppLayer),
  ),
);

type MainServices = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;

/**
 * Runs one repository call to completion on this tick. `node:sqlite` is
 * synchronous, so the imperative code that has not moved onto the store yet
 * can keep calling the repositories as plain functions.
 */
export function useSync<I extends MainServices, S, A>(
  tag: Context.Key<I, S>,
  call: (service: S) => Effect.Effect<A>,
): A {
  return runtime.runSync(Effect.flatMap(Effect.service(tag), call));
}

/** Main's loop. Built with the runtime, so only reached once startup has built it. */
export const mainStore = () => runtime.runSync(Effect.service(MainStore));
