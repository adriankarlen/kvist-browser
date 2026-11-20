import { Context, Layer } from "effect";

/**
 * Hooks into the window code that has not moved onto the store yet. Each
 * one is set when a window opens and cleared when it closes; a Cmd for a
 * window that is gone does nothing.
 */
export interface WindowHooks {
  restoreSession: (allow: boolean) => void;
}

export class LegacyWindow extends Context.Service<
  LegacyWindow,
  { current: WindowHooks | undefined }
>()("kvist/LegacyWindow") {
  static layer = Layer.sync(LegacyWindow, () => ({ current: undefined }));
}
