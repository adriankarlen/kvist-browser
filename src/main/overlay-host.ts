import type { WebContents } from "electron";
import type { Rect } from "../shared/ipc";

/** Everything the completion overlay uses from Chromium. */
export type OverlayContents = Pick<WebContents, "once" | "send" | "isDestroyed">;

export interface OverlayHost {
  webContents: OverlayContents;
  setVisible(visible: boolean): void;
  setBounds(bounds: Rect): void;
}

/**
 * A mounted view with loading started.
 * Release removes it from the stack and closes its webContents.
 */
export interface OverlayLease {
  host: OverlayHost;
  release(): void;
}
