import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import { app, type DownloadItem, type Session } from "electron";
import { Context, Effect, Layer } from "effect";
import type { DownloadStatus } from "../../shared/schema/downloads";
import { MainStore } from "../app/store";
import { warn } from "../features/messages/messages.program";
import { Msg } from "../features/downloads/downloads.program";
import { LegacyWindow } from "./legacy-window";
import { LiveDownloads } from "./live-downloads";
import { resolveDownloadDir, uniqueSavePath } from "./downloads-path";

/**
 * Chromium's downloads, turned into Msgs. `will-download` must pick the save
 * path before it returns, so the reservation and the directory check here
 * are synchronous file system calls on purpose.
 */
export class DownloadsGate extends Context.Service<
  DownloadsGate,
  {
    /** Attached once to the session, for the app's whole life. */
    readonly attach: (session: Session) => void;
    /** `[downloads] dir`; undefined works it out from the XDG download directory. */
    readonly configure: (dir: string | undefined) => void;
  }
>()("kvist/DownloadsGate") {
  static layer = Layer.effect(
    DownloadsGate,
    Effect.gen(function* () {
      const store = yield* MainStore;
      const legacy = yield* LegacyWindow;
      const live = (yield* LiveDownloads).items;
      const reserved = new Set<string>();
      let configured: string | undefined;
      let nextId = 1;

      const directory = (): string => {
        const dir = resolveDownloadDir({
          configured,
          env: process.env.XDG_DOWNLOAD_DIR,
          fallback: app.getPath("downloads"),
          home: homedir(),
        });

        try {
          mkdirSync(dir, { recursive: true });
        } catch (error) {
          store.dispatch(warn(`could not create the download directory ${dir}: ${String(error)}`));
        }

        return dir;
      };

      const sample = (item: DownloadItem, id: number) => ({
        id,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        at: Date.now(),
      });

      /**
       * Both exits release the reservation and the listeners: `done`, and a
       * setup that throws before the transfer could be tracked.
       */
      const adopt = (item: DownloadItem): void => {
        const savePath = uniqueSavePath(
          directory(),
          item.getFilename(),
          (path) => reserved.has(path) || existsSync(path),
        );

        const id = nextId++;

        reserved.add(savePath);

        const onUpdated = (_event: Electron.Event, state: "progressing" | "interrupted"): void => {
          const status: DownloadStatus =
            state === "progressing" && item.isPaused() ? "paused" : state;

          store.dispatch(Msg.cases.DownloadProgressed.make({ ...sample(item, id), status }));
        };

        const onDone = (
          _event: Electron.Event,
          status: Exclude<DownloadStatus, "paused">,
        ): void => {
          item.removeListener("updated", onUpdated);
          reserved.delete(savePath);
          live.delete(id);
          store.dispatch(Msg.cases.DownloadFinished.make({ ...sample(item, id), status }));
        };

        try {
          item.setSavePath(savePath);
          live.set(id, item);
          store.dispatch(
            Msg.cases.DownloadStarted.make({
              download: {
                id,
                filename: basename(savePath),
                url: item.getURL(),
                status: "progressing",
                receivedBytes: item.getReceivedBytes(),
                totalBytes: item.getTotalBytes(),
                bytesPerSecond: 0,
              },
              at: Date.now(),
            }),
          );
          item.on("updated", onUpdated);
          item.once("done", onDone);
        } catch (error) {
          item.removeListener("updated", onUpdated);
          item.removeListener("done", onDone);
          live.delete(id);
          reserved.delete(savePath);
          item.cancel();
          store.dispatch(Msg.cases.DownloadAbandoned.make({ id }));
          throw error;
        }
      };

      return {
        attach: (session) => {
          session.on("will-download", (_event, item, contents) => {
            adopt(item);

            // A download that opened a fresh tab leaves that tab empty.
            if (contents !== null && !contents.isDestroyed())
              legacy.current?.tabDownloaded(contents);
          });
        },
        configure: (dir) => {
          configured = dir;
        },
      };
    }),
  );
}
