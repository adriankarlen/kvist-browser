import { join } from "node:path";
import { WebContentsView } from "electron";
import { Effect } from "effect";
import { RpcServer } from "effect/rpc";
import { SetupIntent, SetupRpcs } from "../../shared/rpc/setup";
import { Msg as SetupMsg } from "../features/setup/setup.program";
import { layout } from "../features/tabs/tabs.program";
import { type KeyInput, type KeySource, Msg as VimMsgs } from "../features/vim/vim.program";
import { interceptKeys } from "../keys";
import { setupLink } from "../links";
import { serve } from "../services/surface";
import { SetupOverlay, type SetupSenders } from "../setup-overlay";
import type { ViewStack } from "../view-stack";
import { mainStore, runtime } from "./runtime";
import { project } from "./store";

const setupPreload = join(import.meta.dirname, "../preload/setup.cjs");
const setupHtml = join(import.meta.dirname, "../renderer/setup.html");

/** The wizard's own surface: it can preview and save choices, and nothing else. */
function serveSetup(contents: Electron.WebContents): SetupSenders {
  const link = setupLink();
  const dispatch = (msg: SetupMsg): void => mainStore().dispatch(msg);

  serve(
    runtime,
    contents,
    RpcServer.make(SetupRpcs).pipe(
      Effect.provide(
        SetupRpcs.toLayer({
          Subscribe: () => link.events.stream,
          Dispatch: (intent) =>
            Effect.sync(() =>
              SetupIntent.match(intent, {
                ChoicesChanged: ({ choices }) =>
                  dispatch(SetupMsg.cases.SetupChoicesChanged.make({ choices })),
                Finished: ({ choices }) => dispatch(SetupMsg.cases.SetupFinished.make({ choices })),
                Skipped: () => dispatch(SetupMsg.cases.SetupSkipped.make({})),
              }),
            ),
        }),
      ),
    ),
  );

  return link.send;
}

/** What the wizard borrows from its window. */
export interface SetupWindowParts {
  readonly views: ViewStack;
  readonly onKey: (input: KeyInput, source: KeySource) => boolean;
  readonly css: () => string;
}

/** The window's handle on its wizard view. */
export interface SetupViewHandle {
  readonly applyCss: () => void;
  readonly release: () => void;
}

/** Mounts the wizard's view whenever the setup slice is open. */
export function mountSetupView(parts: SetupWindowParts): SetupViewHandle {
  const overlay = new SetupOverlay(() => {
    const view = new WebContentsView({ webPreferences: { preload: setupPreload } });
    const contents = view.webContents;
    view.setBackgroundColor("#00000000");
    parts.views.addOverlay(view);

    const loaded = process.env.VITE_DEV_SERVER_URL
      ? contents.loadURL(new URL("setup.html", process.env.VITE_DEV_SERVER_URL).href)
      : contents.loadFile(setupHtml);

    void loaded.catch(() => {
      if (!contents.isDestroyed()) contents.close();
    });

    // Chrome keys, as the palette's are. Insert mode on focus lets every key
    // through in either input mode, so picking vim mid-wizard eats nothing.
    interceptKeys(contents, "chrome", parts.onKey);
    contents.on("focus", () =>
      mainStore().dispatch(VimMsgs.cases.ModeRequested.make({ mode: "insert" })),
    );

    return {
      host: view,
      link: serveSetup(contents),
      release: () => {
        parts.views.remove(view);

        if (!contents.isDestroyed()) contents.close();
      },
    };
  }, parts.css);

  const fiber = runtime.runFork(
    project(
      (model) => ({
        open: model.setup.open,
        seq: model.setup.seq,
        options: model.setup.options,
        saving: model.setup.saving,
        error: model.setup.error ?? undefined,
        bounds: layout(model.tabs).bounds,
      }),
      (view) => overlay.render(view),
    ),
  );

  return {
    applyCss: () => overlay.applyCss(),
    release: () => {
      fiber.interruptUnsafe();
      overlay.release();
    },
  };
}
