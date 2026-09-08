import type { WebContents } from "electron";
import type { Rect } from "../shared/ipc";

/**
 * Everything the completion overlay uses from Chromium, and nothing else.
 * Narrowed with `Pick` for the same reason `PageContents` is: an adapter that
 * cannot contain logic is an adapter a fake cannot drift from.
 */
export type OverlayContents = Pick<WebContents, "once" | "send" | "isDestroyed">;

export interface OverlayHost {
  webContents: OverlayContents;
  setVisible(visible: boolean): void;
  setBounds(bounds: Rect): void;
}

/**
 * A mounted, loading overlay view and the way to take it back down.
 *
 * Creation and mounting are one step because the two cannot be usefully
 * separated: an overlay that exists but is not in the view stack is invisible
 * for reasons no caller could debug. Pairing them with `release` at the point
 * of acquisition is the same shape every other lifetime in the app takes.
 */
export interface OverlayLease {
  host: OverlayHost;
  release(): void;
}
