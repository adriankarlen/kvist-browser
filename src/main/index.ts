import { app, BrowserWindow, session } from "electron";
import { applySettings as applyAdblockSettings } from "./adblock";
import {
  applySettings as applyLocalPageSettings,
  registerKvistProtocol,
  registerKvistScheme,
} from "./local-pages";
import { Msg as LibraryMsg } from "./features/library/library.program";
import { BookmarksRepo } from "./services/bookmarks-repo";
import { ConfigFiles } from "./services/config-files";
import { DownloadsGate } from "./services/downloads-gate";
import { MainStore } from "./app/store";
import { applyXdgPaths, configDir, dataDir } from "./paths";
import { probeFirstRun } from "./first-run";
import { PromptsGate } from "./services/prompts-gate";
import { Msg as ConfigMsg } from "./features/config/config.program";
import { Msg as SetupMsg } from "./features/setup/setup.program";
import { ConfigApplier } from "./services/config-applier";
import { StyleFiles } from "./services/style-files";
import { ZoomRepo } from "./services/zoom-repo";
import { disposeNow } from "./runtime";
import { Effect, Exit, Stream } from "effect";
import { NodeServices } from "@effect/platform-node";

import { mainStore, runtime, useSync } from "./app/runtime";
import { createWindow, library, loadSession, tabManagers, userStyles } from "./app/window";

applyXdgPaths();

registerKvistScheme();

/**
 * A second launch is a relaunch: the lock keeps two processes from opening
 * kvist.db, since WAL forbids concurrent writers. The lock-false copy
 * quits; the first refocuses its window, so a dock click opens, not
 * another instance.
 */
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // The OS already tried to launch a second copy; it now exits and we
    // refocus whatever window the user is likely after.
    const windows = BrowserWindow.getAllWindows();
    const target = windows[0];

    if (target !== undefined) {
      if (target.isMinimized()) target.restore();
      target.focus();
    }
  });

  void app.whenReady().then(async () => {
    const firstRun = await Effect.runPromise(
      probeFirstRun(configDir, dataDir).pipe(Effect.provide(NodeServices.layer)),
    );

    // A bad migration or a corrupt database is a real failure: log and quit
    // rather than leave the user staring at a window that never appears.
    const built = await runtime.runPromiseExit(Effect.void);

    if (Exit.isFailure(built)) {
      Effect.runSync(Effect.logError("could not start", built.cause));
      app.quit();

      return;
    }

    useSync(PromptsGate, (gate) => Effect.sync(() => gate.attach(session.defaultSession)));
    useSync(DownloadsGate, (gate) => Effect.sync(() => gate.attach(session.defaultSession)));

    const applier = runtime.runSync(Effect.service(ConfigApplier));

    applier.targets = {
      // Load-bearing order: blocking attaches to the session before the
      // first tab loads, and local pages are configured before one is served.
      config: async (config) => {
        await applyAdblockSettings(config);
        applyLocalPageSettings(config);
        useSync(DownloadsGate, (gate) =>
          Effect.sync(() => gate.configure(config.settings.downloadDir)),
        );
      },
      // An edit must restyle what is already open, not wait for each page's
      // next navigation.
      styles: (sources) => {
        const problems = userStyles.setSources([...sources]);

        for (const views of tabManagers) {
          views.forEachTab((contents, url) => userStyles.applyTo(contents, url));
        }

        return problems;
      },
    };

    // Both watchers feed the store; startup waits for the first config to be
    // applied and the first style scan to be in.
    const configFiber = runtime.runFork(
      Effect.flatMap(Effect.service(ConfigFiles), ({ changes }) =>
        Stream.runForEach(changes, (loaded) =>
          Effect.sync(() => mainStore().dispatch(ConfigMsg.cases.ConfigLoaded.make(loaded))),
        ),
      ),
    );

    const styleFiber = runtime.runFork(
      Effect.flatMap(Effect.service(StyleFiles), ({ changes }) =>
        Stream.runForEach(changes, (sources) =>
          Effect.sync(() => mainStore().dispatch(ConfigMsg.cases.StylesLoaded.make({ sources }))),
        ),
      ),
    );

    await runtime.runPromise(
      Effect.flatMap(Effect.service(MainStore), (store) =>
        store.changes.pipe(
          Stream.filter((model) => model.config.current !== null),
          Stream.take(1),
          Stream.runDrain,
        ),
      ),
    );
    registerKvistProtocol();

    // The single prompt queue: permission asks and the session-restore ask
    // share one mechanism, one observer wiring, one keybind set, one IPC
    // channel. App-scoped because the chrome renders one line at a time and
    // a permission prompt outliving its tab is the only cross-window concern
    // — already handled inside `Permissions` via `Prompts.cancel`.
    // `sessions.load()` is forgiving: missing or malformed row collapses to
    // null, which is indistinguishable from a fresh first launch — the right
    // answer when an old build has never written the table or when a corrupt
    // row is left behind by a crash.
    const loaded = runtime.runSync(
      Effect.all({
        bookmarked: Effect.flatMap(Effect.service(BookmarksRepo), (repo) => repo.urls),
        zoom: Effect.flatMap(Effect.service(ZoomRepo), (repo) => repo.all),
      }),
    );

    library(
      LibraryMsg.cases.LibraryLoaded.make({
        bookmarked: [...loaded.bookmarked],
        zoom: [...loaded.zoom],
      }),
    );
    createWindow(loadSession());

    if (firstRun) mainStore().dispatch(SetupMsg.cases.SetupOpened.make({}));

    // The config watcher and the zoom store are both acquired once and released
    // on quit. The store additionally holds the quit until its queued write has
    // landed: a Ctrl-wheel nudge inside the debounce window is otherwise lost.
    app.on("will-quit", () => configFiber.interruptUnsafe());
    app.on("will-quit", () => styleFiber.interruptUnsafe());
    // `quit` rather than `will-quit`: `will-quit` is cancellable, and an app
    // that keeps running with a closed database throws out of every later
    // query — `activate` calling `Session.load` is the one that surfaced.
    // `quit` only fires once the app is definitely going.
    app.on("quit", () => {
      disposeNow(runtime);
    });
    runtime.runFork(Effect.logInfo("kvist started"));

    app.on("activate", () => {
      // macOS reopen: a re-launched app with no windows restores the last
      // session, same as cold start. Re-reading from the store is cheap and
      // avoids the alternative of carrying the row across the app's lifetime.
      if (BrowserWindow.getAllWindows().length === 0) createWindow(loadSession());
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
