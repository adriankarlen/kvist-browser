import { Context, Layer } from "effect";
import type { TabViews } from "../tab-views";

/**
 * Hooks into the window code that has not moved onto the store yet. Each
 * one is set when a window opens and cleared when it closes; a Cmd for a
 * window that is gone does nothing.
 */
export interface WindowHooks {
  tabs: TabViews;
  restoreSession: (allow: boolean) => void;
  /** Runs a command by name; an unknown one is reported in the echo area. */
  runCommand: (name: string, arg: string | undefined) => void;
  /** A download started from this tab, which may have opened it just for that. */
  tabDownloaded: (contents: Electron.WebContents) => void;
}

export class LegacyWindow extends Context.Service<
  LegacyWindow,
  { current: WindowHooks | undefined }
>()("kvist/LegacyWindow") {
  static layer = Layer.sync(LegacyWindow, () => ({ current: undefined }));
}
